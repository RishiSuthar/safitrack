// ============================================================
// SafiTrack – CRM Configuration
// ============================================================
// ✅ SAFE TO COMMIT — this file contains only public-safe values.
//
// SECURITY NOTES:
//  • SUPABASE_KEY is the "anon" (public) key — it is designed to
//    be exposed in the browser. Your Row Level Security (RLS)
//    policies are what protect the data, not this key.
//    Add your site domain to Supabase → Auth → URL Configuration
//    → Allowed Redirect URLs for extra protection.
//
//  • GROQ API key is a SECRET stored as a Supabase edge function
//    secret (via `supabase secrets set GROQ_API_KEY=...`).
//    It never reaches the browser. AI calls go through the proxy.
//
// For VERSION and CHANGELOG, edit version.js instead.
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
  GEMINI_PROXY_URL: "https://ndrkncirkekpqjjkasiy.supabase.co/functions/v1/gemini-proxy",
});

