// ============================================================
// SafiTrack – Version & Changelog
// ============================================================
// ✅ SAFE TO COMMIT — no secrets here.
//
// HOW TO SHIP A NEW RELEASE:
//  1. Bump VERSION to the new number (e.g. "2.1.0")
//  2. Add a new block at the TOP of CHANGELOG with the same version
//  3. Save, commit, and deploy
//  → The "What's New" popup will automatically appear for every
//    user on their next login.
//
// item types: "new" | "improved" | "fixed"
// ============================================================

window.APP_CONFIG = window.APP_CONFIG || {};

Object.assign(window.APP_CONFIG, {
  VERSION: "2.0.0",

  CHANGELOG: [
    {
      version: "2.0.0",
      date: "June 30, 2026",
      items: [
        { type: "new",      text: "Added custom opportunity pipelines with different stages" },
        { type: "improved", text: "Load stacked company icons - faster load time now" },
        { type: "fixed",    text: "Opportunity view for mobile now fixed the search bar" },
      ],
    },
    {
      version: "1.9.0",
      date: "June 10, 2026",
      items: [
        { type: "fixed",    text: "Mobile view for technicians" },
      ],
    },
  ],
});
