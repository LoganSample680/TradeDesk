import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
        max_tokens: 400,
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
