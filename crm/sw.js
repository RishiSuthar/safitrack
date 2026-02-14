const CACHE_NAME = 'safitrack-crm-v2';
const ASSETS = [
    '/crm/',
    '/crm/index.html',
    '/crm/styles.css',
    '/crm/app.js',
    '/crm/ai.js',
    '/crm/onboarding.js',
    '/crm/utils.js',
    '/assets/icons/whiteblue.ico',
    '/assets/icons/whiteblue.png'
];

// Install Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activate & Cleanup
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
                );
            }),
            self.clients.claim()
        ])
    );
});

// Network First (fallback to cache) Strategy
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

self.addEventListener('push', (event) => {
    let payload = {};

    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'SafiTrack Alert';
    const body = payload.body || 'You have a new notification.';

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/assets/icons/whiteblue.png',
            badge: '/assets/icons/whiteblue.png',
            tag: payload.tag || undefined,
            data: {
                url: payload.url || '/crm/'
            }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification?.data?.url || '/crm/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('/crm') && 'focus' in client) {
                    return client.focus();
                }
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});
