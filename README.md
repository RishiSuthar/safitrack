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

## 📸 Screenshots

> Screenshots coming soon.

