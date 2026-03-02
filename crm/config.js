// ============================================================
// SafiTrack – CRM Configuration
// ============================================================
// DO NOT commit this file to source control.
// It is listed in .gitignore.
//
// Copy crm/config.example.js → crm/config.js and fill in
// your keys.
//
// SECURITY NOTES:
//  • SUPABASE_KEY is the "anon" (public) key — it is safe to
//    expose in the browser AS LONG AS Row Level Security (RLS)
//    is enabled on every table in your Supabase project.
//    Add your site domain to Supabase → Auth → URL Configuration
//    → Allowed Redirect URLs for extra protection.
//
//  • GROQ API key is a SECRET and is stored as a Supabase secret
//    (via `supabase secrets set GROQ_API_KEY=...`).
//    It never reaches the browser. AI calls are proxied through
//    supabase/functions/groq-proxy/index.ts.
//    Only the proxy URL (GROQ_PROXY_URL) is in this file, which
//    is safe to expose.
// ============================================================

window.APP_CONFIG = window.APP_CONFIG || {};

Object.assign(window.APP_CONFIG, {
  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL: "https://ndrkncirkekpqjjkasiy.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4",

  // ── Groq AI proxy ─────────────────────────────────────────
  // The real Groq API key is stored as a Supabase secret (never in the browser).
  // Set this to your deployed edge function URL:
  //   supabase functions deploy groq-proxy
  // Then copy the printed URL here.
  GROQ_PROXY_URL: "https://ndrkncirkekpqjjkasiy.supabase.co/functions/v1/groq-proxy",
});
