const CACHE_NAME = 'lanovel-cache-v1';
// App Shell: Core files needed for the app to run offline
const APP_SHELL_URLS = [
    '/', // This should map to the root, which is library.html
    '/book', // Endpoint for book_ui.html
    '/viewer',
    '/admin',
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

    // For navigation (HTML pages), use Network falling back to Cache
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
            .then(response => {
                // If the network is available, cache the new page
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, response.clone());
                    return response;
                });
            })
            .catch(() => {
                // If the network fails, serve from cache
                return caches.match(event.request).then(response => {
                    return response || caches.match('/'); // Fallback to root if specific page isn't cached
                });
            })
        );
        return;
    }

    // For API calls to the local server (e.g., /translations, /stream), always go to the network.
    // This is crucial because this is dynamic data. We will cache the stream data separately.
    if (url.origin === self.location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/translations') || url.pathname.startsWith('/stream'))) {
        // For stream, we will implement a more specific caching in the viewer page itself.
        // For now, just pass through.
        event.respondWith(fetch(event.request));
        return;
    }

    // For other requests (CSS, JS), use Cache falling back to Network
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request).then(networkResponse => {
                // Cache the new asset for future use
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            });
        })
    );
});