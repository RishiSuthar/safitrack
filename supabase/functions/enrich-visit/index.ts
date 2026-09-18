import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Mirrors the exact Gemini call pattern used in safai-assistant (which is verified working).
// Same model list, same fallback logic, same payload structure.
async function callGemini(
  apiKey: string,
  systemText: string,
  userText: string,
  maxOutputTokens: number,
): Promise<string | null> {
  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
  ];

  const geminiPayload = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: {
      parts: [{ text: systemText }],
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens,
    },
  };

  let geminiRes: Response | null = null;
  let geminiData: any = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      });
      const d = await res.json();
      if (res.ok && !d.error) {
        geminiRes = res;
        geminiData = d;
        console.log(`enrich-visit: success with model ${model}`);
        break;
      } else {
        const errCode = d.error?.code || res.status;
        const errMsg = d.error?.message || 'unknown error';
        console.warn(`enrich-visit: model ${model} failed (${res.status}): ${String(errMsg).substring(0, 80)}`);
        // Continue to next on quota / not-found / overloaded
        if (res.status === 404 || res.status === 429 || res.status === 503 ||
            errCode === 404 || errCode === 429 || errCode === 503) {
          continue;
        }
        // Fatal error — no point retrying other models
        geminiRes = res;
        geminiData = d;
        break;
      }
    } catch (fErr) {
      console.warn(`enrich-visit: fetch error for ${model}:`, fErr);
    }
  }

  if (!geminiRes || !geminiData || !geminiRes.ok) {
    return null;
  }

  // Extract text — handles thinking model responses (same as safai-assistant)
  const candidate = geminiData.candidates?.[0];
  const text =
    candidate?.content?.parts?.find((p: any) => p.text && !p.thoughtSignature)?.text ||
    candidate?.content?.parts?.[0]?.text ||
    '';
  return text.trim() || null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Always return HTTP 200 so the Supabase client never throws FunctionsHttpError.
  // Enrichment is best-effort — a failure here must never surface as an error to the user.
  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY || !supabaseUrl || !anonKey || !serviceKey) {
      console.error('enrich-visit: missing env vars');
      return json({ ok: false, skipped: true });
    }

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, skipped: true });

    const token = authHeader.replace('Bearer ', '').trim();
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: { user } } = await userClient.auth.getUser(token);
    if (!user) return json({ ok: false, skipped: true });

    const body = await req.json().catch(() => ({}));
    const { visitId, company, contact, notes, visitType } = body;

    if (!visitId || !company || !notes) {
      return json({ ok: false, skipped: true });
    }

    const notesStr = String(notes);
    const companyStr = String(company);
    const contactStr = String(contact || 'Unknown');
    const visitTypeStr = String(visitType || 'General');

    // Run summary and lead score in parallel
    const [summaryText, scoreText] = await Promise.all([
      callGemini(
        GEMINI_API_KEY,
        'You are Safi A.I, a concise assistant. Generate a very concise summary of a sales visit in 2-3 bullet points. Focus on key outcomes and next steps. Use bullet points with * and keep it under 100 words total.',
        `Summarize this visit to ${companyStr} with ${contactStr}:\n\nNotes: ${notesStr.substring(0, 500)}`,
        250,
      ),
      callGemini(
        GEMINI_API_KEY,
        'You are Safi A.I, a sales assistant that predicts lead conversion probability. Analyze the visit details and return ONLY a number between 0-100 representing the lead score. Consider: engagement level, decision-maker access, budget signals, timeline urgency, and pain points mentioned.',
        `Analyze this sales visit and predict lead score (0-100):\n\nCompany: ${companyStr}\nContact: ${contactStr}\nVisit Type: ${visitTypeStr}\nNotes: ${notesStr.substring(0, 400)}\n\nReturn only the numeric score.`,
        20,
      ),
    ]);

    const updates: Record<string, any> = {};

    if (summaryText) {
      updates.ai_summary = summaryText;
    }

    if (scoreText) {
      const score = parseInt(scoreText.match(/\d+/)?.[0] || '');
      if (!isNaN(score)) {
        updates.lead_score = Math.min(100, Math.max(0, score));
      }
    }

    if (Object.keys(updates).length === 0) {
      console.log('enrich-visit: no AI results to write for visit', visitId);
      return json({ ok: true, updated: [] });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { error: updateErr } = await supabaseAdmin
      .from('visits')
      .update(updates)
      .eq('id', visitId);

    if (updateErr) {
      console.error('enrich-visit: DB update failed:', updateErr.message);
      return json({ ok: false, error: updateErr.message });
    }

    console.log(`enrich-visit: updated visit ${visitId} with`, Object.keys(updates));
    return json({ ok: true, updated: Object.keys(updates), leadScore: updates.lead_score ?? null });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('enrich-visit unhandled error:', message);
    // Still return 200 — enrichment failure must never affect the saved visit
    return json({ ok: false, error: message });
  }
});
