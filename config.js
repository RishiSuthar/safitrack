// ============================================================
// SafiTrack – Landing Page Configuration
// ============================================================
// DO NOT commit this file to source control.
// It is listed in .gitignore.
//
// Copy config.example.js → config.js and fill in your keys.
//
// SECURITY NOTES:
//  • EmailJS keys are "public-safe" — protect them by adding
//    your site's domain as an Allowed Origin in the EmailJS
//    dashboard (Account → Security).
//  • Never place server-side secrets (e.g. private API keys)
//    in this file — it is loaded in the browser.
// ============================================================

window.APP_CONFIG = window.APP_CONFIG || {};

Object.assign(window.APP_CONFIG, {
  // ── EmailJS ──────────────────────────────────────────────
  EMAILJS_PUBLIC_KEY:   "gBlS97W9mCMXx6qRf",
  EMAILJS_SERVICE_ID:   "service_5hj9xoc",
  EMAILJS_TEMPLATE_ID:  "template_suu7kp6",
});
