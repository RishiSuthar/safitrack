const CACHE_NAME = 'safitrack-crm-v18';
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

// Only static assets are cached: the app's own files and the CDN libraries it
// loads. API responses (Supabase etc.) carry user data and must never be stored,
// or they would outlive logout on shared devices.
const CACHEABLE_CDN_HOSTS = [
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

function isCacheable(request) {
    if (request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) return true;
    return CACHEABLE_CDN_HOSTS.includes(url.hostname);
}

// Network First (fallback to cache) Strategy
self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith('http') || !isCacheable(event.request)) return;
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
    const targetView = event.notification?.data?.view;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('/crm') && 'focus' in client) {
                    client.focus();
                    if (targetView) {
                        client.postMessage({
                            type: 'NAVIGATE',
                            view: targetView,
                            entityId: event.notification?.data?.entityId,
                            entityType: event.notification?.data?.entityType,
                        });
                    }
                    return;
                }
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});
