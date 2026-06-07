import { createClient } from 'npm:@supabase/supabase-js@2';
import { getAnonKey } from '../_shared/keys.ts';

const ALLOWED_ORIGIN = '*';

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    });
  }

  try {
    // Verify the caller is an authenticated Supabase user
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getAnonKey(),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      });
    }

    // Get image from request
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      });
    }

    // Call Anthropic API with the key stored securely in Supabase secrets
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64,
              }
            },
            {
              type: 'text',
              text: 'Extract from this receipt: vendor name, total amount paid (number only, no $ sign), date (YYYY-MM-DD format), and best IRS Schedule C category from: materials, tools, fuel, vehicle, subs, insurance, marketing, phone, ppe, meals, professional, fees, rent, utilities, other. Return ONLY valid JSON with no markdown or explanation: {"vendor":"","amount":0,"date":"","category":"","notes":""}'
            }
          ]
        }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('Anthropic error:', err);
      return new Response(JSON.stringify({ error: 'AI service error', detail: err }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      });
    }

    const data = await anthropicRes.json();
    const raw = data.content?.find((c: any) => c.type === 'text')?.text || '{}';
    
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { vendor: '', amount: 0, date: '', category: 'other', notes: '' };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
    });

  } catch (err) {
    console.error('scan-receipt error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
    });
  }
});
