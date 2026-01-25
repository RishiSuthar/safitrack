const CACHE_NAME = 'safitrack-crm-v1';
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
            console.log('SW: Caching static assets');
            return cache.addAll(ASSETS);
        })
    );
});

// Activate & Cleanup
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
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
