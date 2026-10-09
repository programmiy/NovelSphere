const CACHE_NAME = 'lanovel-cache-v4-__GIT_HASH__';
// App Shell: Core files needed for the app to run offline
const APP_SHELL_URLS = [
    '/', // Root (library.html or library_mobile.html depending on UA)
    '/m', // Direct mobile entrypoint
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
    '/static/library_mobile.css',
    '/static/library_mobile.js',
    '/static/viewer.css',
    '/static/viewer.js',
    '/static/steampunk-sound.js'
];

// Install event: cache the app shell
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    self.skipWaiting();
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

    // Strategy for dynamic API data (books, folders, tags, activity, config, etc.)
    // Network-First with Cache Fallback:
    // Always fetch from server first to immediately reflect DB updates (completion tag, bookmarks, notes, etc.).
    // Falls back to offline cache if network is unavailable.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/folders')) {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Strategy for content & streaming data (translations, stream)
    // Cache-First with Network fallback for fast reading and offline support
    if (url.pathname.startsWith('/translations') || url.pathname.startsWith('/stream')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const networkFetch = fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(err => {
                        console.warn('Network fetch failed for translation content:', err);
                    });

                    return cachedResponse || networkFetch;
                });
            })
        );
        return;
    }

    // Strategy for HTML page navigation (Network-First to always respect device/UA PC default)
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    return caches.match(event.request).then(cached => {
                        return cached || caches.match('/');
                    });
                })
        );
        return;
    }

    // Strategy for App Shell assets (CSS, JS, Fonts, Images)
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