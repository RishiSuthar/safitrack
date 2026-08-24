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
//  • GEMINI API key is stored directly here to enable direct 
//    API calls to Google. Note: For production, consider moving
//    this to a secure backend or edge proxy.
// For VERSION and CHANGELOG, edit version.js instead.
// ============================================================

window.APP_CONFIG = window.APP_CONFIG || {};

Object.assign(window.APP_CONFIG, {
  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL: "https://ndrkncirkekpqjjkasiy.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcmtuY2lya2VrcHFqamthc2l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDU2MTEsImV4cCI6MjA4MTE4MTYxMX0.SGVLqU6-u1ALj_P1nsyytYe7cNbAyxCVbV6kjAaiGU4",

  // ── Gemini AI ─────────────────────────────────────────
  GEMINI_API_KEY: "API_KEY_MOVED_TO_SUPABASE",
});

