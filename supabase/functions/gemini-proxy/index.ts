import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY || !supabaseUrl || !anonKey || !serviceKey) {
      throw new Error('Missing required environment variables');
    }

    const authHeader = req.headers.get('Authorization');
    const action = req.headers.get('X-AI-Action') || 'general';
    const body = await req.json().catch(() => ({}));
    
    if (body.listModels) {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
      const listData = await listRes.json();
      return json(listData, listRes.status);
    }
    const requestedModel = req.headers.get('X-Gemini-Model') || body.model || 'gemini-2.5-flash';
    // Remove custom model property if present in body before forwarding to Gemini
    const { model: _omittedModel, ...geminiPayload } = body;

    let userId: string | null = null;
    let orgIdPromise: Promise<string | null> = Promise.resolve(null);

    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey);
      const token = authHeader.replace('Bearer ', '').trim();
      const { data: { user } } = await userClient.auth.getUser(token);
      
      if (user) {
        userId = user.id;
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);
        orgIdPromise = supabaseAdmin
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single()
          .then(res => res.data?.organization_id || null)
          .catch(() => null);
      }
    }

    // Attempt Gemini call with candidate models (verified on API)
    const candidateModels = [
      requestedModel,
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-flash-latest'
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let response: Response | null = null;
    let data: any = null;

    const errorsList: any[] = [];
    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(geminiPayload)
        });
        const resData = await res.json();
        if (res.ok && !resData.error) {
          response = res;
          data = resData;
          break;
        } else {
          errorsList.push({ model, status: res.status, error: resData.error || resData });
        }
      } catch (fetchErr: any) {
        errorsList.push({ model, fetchError: fetchErr.message || String(fetchErr) });
      }
    }

    const orgId = await orgIdPromise;
    if (!response || !data) {
      return json({ error: 'All Gemini model endpoints failed', details: errorsList }, 502);
    }
    
    // Log AI Usage asynchronously (do not await)
    if (userId && data.usageMetadata) {
      const supabaseAdmin = createClient(supabaseUrl, serviceKey);
      supabaseAdmin.from('ai_usage_logs').insert([{
        organization_id: orgId || null,
        user_id: userId,
        action: action,
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        candidates_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0
      }]).then(({ error: insertError }) => {
        if (insertError) console.error("Failed to insert AI usage log:", insertError);
      });
    }

    return json(data, response.status);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return json({ error: msg }, 400);
  }
});
