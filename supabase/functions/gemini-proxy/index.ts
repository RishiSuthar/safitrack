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
    let userId: string | null = null;
    let orgId: string | null = null;

    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey);
      const token = authHeader.replace('Bearer ', '').trim();
      const { data: { user } } = await userClient.auth.getUser(token);
      
      if (user) {
        userId = user.id;
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();
        
        if (profile) {
          orgId = profile.organization_id;
        }
      }
    }

    const action = req.headers.get('X-AI-Action') || 'general';
    const body = await req.json().catch(() => ({}));
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    
    // Log AI Usage asynchronously if possible, or await it
    if (userId && data.usageMetadata) {
      const supabaseAdmin = createClient(supabaseUrl, serviceKey);
      const { error: insertError } = await supabaseAdmin.from('ai_usage_logs').insert([{
        organization_id: orgId || null,
        user_id: userId,
        action: action,
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        candidates_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0
      }]);
      
      if (insertError) {
        console.error("Failed to insert AI usage log:", insertError);
      }
    } else {
      console.warn("Skipping AI usage log. userId:", userId, "orgId:", orgId, "hasUsageMetadata:", !!data.usageMetadata);
    }

    return json(data, response.status);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    return json({ error: msg }, 400);
  }
});
