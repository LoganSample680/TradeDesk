import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 2025 IRS baselines for bracket validation (±15% bounds)
const BRACKET_BASE = {
  fedSingle: 15000, b10: 11925, b12: 48475,
  b22: 103350, b24: 197300, b32: 250525, b35: 626350,
  fedMFJ: 30000, fedHOH: 22500,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    const body = await req.json().catch(() => ({}));
    const type = body.type;
    const year = new Date().getFullYear();

    let prompt: string;
    if (type === 'sw') {
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      prompt = 'Provide estimated current Sherwin-Williams contractor (PRO+ account, ~35% off retail) prices per gallon for Topeka Kansas as of ' + month + '. Return ONLY valid JSON, no other text: {"pm700":{"c":20,"r":55},"pm200":{"c":32,"r":83},"sp":{"c":37,"r":65},"cash":{"c":40,"r":60},"dur":{"c":46,"r":70},"em":{"c":52,"r":74},"emde":{"c":62,"r":95},"spe":{"c":38,"r":63},"dure":{"c":48,"r":81},"eme":{"c":54,"r":86},"emure":{"c":58,"r":95}} where c=contractor price, r=retail price';
    } else if (type === 'taxBrackets') {
      prompt = `Per IRS Revenue Procedure for tax year ${year}, what are the federal income tax bracket thresholds for single filers and the standard deductions? Also provide Kansas state income tax rates for ${year} (two-bracket system: lower rate, upper rate, bracket top for single filer, and standard deductions). Return ONLY valid JSON with no other text: {"year":${year},"fedSingle":15000,"fedMFJ":30000,"fedHOH":22500,"b10":11925,"b12":48475,"b22":103350,"b24":197300,"b32":250525,"b35":626350,"ksLow":3.1,"ksHigh":5.7,"ksTop":33000,"ksStdS":3500,"ksStdM":8000}`;
    } else if (type === 'lienRules') {
      const current = JSON.stringify(body.current || {});
      prompt = `You are reviewing mechanic's lien filing deadlines (days from last day of work) for all US states. The app currently uses these values: ${current}. Based on current statutes as of ${year}, identify any states where the filing deadline has changed from the listed value. Return ONLY valid JSON with no other text: {"changes":{"XX":90}} where XX is the 2-letter state code and the number is the correct filing_deadline_days. If nothing has changed, return {"changes":{}}.`;
    } else if (type === 'stateBrackets') {
      const state = body.state as string;
      if (!state || !/^[A-Z]{2}$/.test(state)) {
        return new Response(JSON.stringify({ error: 'Invalid state' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...CORS }
        });
      }
      prompt = `What are the ${state} state individual income tax rates for tax year ${year}? Provide the bracket structure for single filers. Return ONLY valid JSON with no other text: {"state":"${state}","noTax":false,"stdS":3500,"stdM":8000,"brackets":[{"top":15000,"rate":3.1},{"top":9999999,"rate":5.7}]} where top is the income ceiling of each bracket in dollars (use 9999999 for the top bracket), rate is the percentage, stdS is the standard deduction for single filers, stdM for married filing jointly. If the state has no income tax, return {"state":"${state}","noTax":true,"stdS":0,"stdM":0,"brackets":[]}.`;
    } else {
      prompt = `What is the current IRS standard mileage rate for business driving in ${year}? Return ONLY valid JSON with no explanation: {"irsRate":0.700,"year":${year},"effective":"January 1, ${year}"}`;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: type === 'stateBrackets' ? 600 : 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Anthropic error:', res.status, err);
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    const data = await res.json();
    const text = data.content?.find((c: any) => c.type === 'text')?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};

    // Server-side validation for lien rules — reject any out-of-range deadlines
    if (type === 'lienRules') {
      const changes = parsed.changes;
      if (!changes || typeof changes !== 'object') {
        return new Response(JSON.stringify({ changes: {} }), {
          headers: { 'Content-Type': 'application/json', ...CORS }
        });
      }
      const validated: Record<string, number> = {};
      for (const [state, days] of Object.entries(changes)) {
        if (/^[A-Z]{2}$/.test(state) && typeof days === 'number' && days >= 30 && days <= 400) {
          validated[state] = days;
        }
      }
      return new Response(JSON.stringify({ changes: validated }), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    // Server-side validation for tax brackets — reject hallucinated values
    if (type === 'taxBrackets') {
      const primaryFields = ['fedSingle', 'b10', 'b12', 'b22', 'b24', 'b32', 'b35'] as const;
      const boundsOk = primaryFields.every(k => {
        const v = parsed[k];
        const base = BRACKET_BASE[k];
        return typeof v === 'number' && v > base * 0.85 && v < base * 1.15;
      });
      const thresholds = [parsed.b10, parsed.b12, parsed.b22, parsed.b24, parsed.b32, parsed.b35];
      const strictlyIncreasing = thresholds.every((v, i, a) => i === 0 || v > a[i - 1]);
      if (!boundsOk || !strictlyIncreasing) {
        console.warn('Tax bracket validation failed:', parsed);
        return new Response(JSON.stringify({ error: 'validation failed' }), {
          status: 422, headers: { 'Content-Type': 'application/json', ...CORS }
        });
      }
    }

    // stateBrackets: return parsed JSON directly — no additional strict validation
    if (type === 'stateBrackets') {
      const st = body.state as string;
      if (parsed.state !== st) parsed.state = st; // ensure state field is correct
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json', ...CORS }
    });

  } catch (err) {
    console.error('get-rates error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
    });
  }
});
