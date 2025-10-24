const CACHE_NAME = 'lanovel-cache-__GIT_HASH__';
// App Shell: Core files needed for the app to run offline
const APP_SHELL_URLS = [
    '/', // This should map to the root, which is library.html
    '/book', // Endpoint for book_ui.html
    '/viewer',
    '/admin',
    '/logs',
    '/static/manifest.json',
    '/service-worker.js',
    '/static/admin.css',
    '/static/admin.js',
    '/static/book_ui.css',
    '/static/book_ui.js',
    '/static/library.css',
    '/static/library.js',
    '/static/viewer.css',
    '/static/viewer.js'
];

// Install event: cache the app shell
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Service Worker: Caching App Shell');
            // Use addAll for atomic caching
            return cache.addAll(APP_SHELL_URLS);
        }).catch(error => {
            console.error('Failed to cache App Shell:', error);
        })
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Fetch event: serve from cache or network (Stale-While-Revalidate for assets, Network-First for navigation)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Ignore non-GET requests and requests to external domains
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // Strategy for API data (e.g., book content, folders, etc.)
    // Cache first, then network. This makes the app feel fast and work offline.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/translations') || url.pathname.startsWith('/stream') || url.pathname.startsWith('/folders')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const networkFetch = fetch(event.request).then(networkResponse => {
                        // Update the cache with the new response
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });

                    // Return cached response immediately if available, otherwise wait for network
                    return cachedResponse || networkFetch;
                });
            })
        );
        return;
    }

    // Strategy for App Shell and other assets (CSS, JS, HTML)
    // Stale-While-Revalidate. Serve from cache immediately, then update in the background.
    event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
            return cache.match(event.request).then(cachedResponse => {
                const networkFetch = fetch(event.request).then(networkResponse => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(err => {
                    console.error('Service Worker: Fetch failed.', err);
                });

                return cachedResponse || networkFetch;
            });
        })
    );
});