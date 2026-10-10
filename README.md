<div align="center">

# SafiTrack

📍 A modern field sales tracking & route management web application.

SafiTrack helps businesses manage field agents, routes, locations, and visit logs — all in one clean, easy-to-use platform.

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![Built With](https://img.shields.io/badge/built%20with-HTML%20%7C%20CSS%20%7C%20JavaScript-blue)

</div>

---

## 🚀 Features

- 🧑‍💼 Field agent management
- 🗺 Route & location tracking
- 📝 Visit logging with notes, photos & signatures
- 📍 GPS-based location capture
- 📱 Mobile-friendly & responsive UI
- 🔒 Secure authentication (planned / in progress)

---

## 🛠 Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Supabase, JavaScript
- **Database:** Supabase
- **Hosting:** Netlify
---

## Local Development (CRM SPA Routing)

If you refresh a client-side route such as /crm/deals on a plain static server, you may get a 404. This is expected without rewrite rules.

Run the local SPA-aware server from the project root:

```bash
python3 scripts/spa_server.py 8000
```

Then open:

- http://localhost:8000/crm/index.html
- http://localhost:8000/crm/deals
- http://localhost:8000/crm/contacts

Refresh, bookmarks, and Back/Forward will continue to work for CRM routes.

## Database & Edge Functions

- **Schema changes** go in `supabase/migrations/` as new, timestamped SQL files, applied in filename order (Supabase SQL editor or `supabase db push`). Never edit a migration that has already been applied; add a new one.
- **Edge Functions** live in `supabase/functions/` and are deployed with `supabase functions deploy <name>`. Secrets (e.g. `GEMINI_API_KEY`) are set with `supabase secrets set`, never in `config.js`.
- `supabase/legacy-sql/` holds the hand-run scripts from before migrations. They are out of date — do not run them.
- Access control is enforced by Row Level Security in the database: users only see their own organization, and non-managers only see their own visits, deals and tasks. The keys in `config.js` are public by design.

## 📸 Screenshots

> Screenshots coming soon.

