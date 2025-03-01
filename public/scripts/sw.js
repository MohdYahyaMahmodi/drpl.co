// Service Worker for drpl.co
const CACHE_NAME = 'drpl-cache-v1';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',  // Make sure to include the offline page
  '/styles/styles.css',
  '/scripts/ui.js',
  '/scripts/network.js',
  '/scripts/theme.js',
  '/scripts/background-animation.js',
  '/scripts/notifications.js',
  '/images/favicon.png',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching static assets');
        // First, add the offline page separately to ensure it's cached
        return cache.add('/offline.html')
          .catch(error => {
            console.error('Failed to cache offline.html:', error);
          })
          .then(() => {
            // Then add other static assets
            return cache.addAll(STATIC_ASSETS.filter(url => url !== '/offline.html'))
              .catch(error => {
                console.error('Cache addAll error:', error);
                // Continue even if some assets fail to cache
                return Promise.resolve();
              });
          });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.filter((name) => {
            return name !== CACHE_NAME;
          }).map((name) => {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and socket connections
  if (event.request.method !== 'GET' || 
       event.request.url.includes('/server')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached response if found
        if (response) {
          return response;
        }

        // Clone the request - it's a one-time use object
        const fetchRequest = event.request.clone();

        // Try to fetch from network
        return fetch(fetchRequest)
          .then((response) => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response - it's a one-time use object
            const responseToCache = response.clone();

            // Cache the new resource
            caches.open(CACHE_NAME)
              .then((cache) => {
                try {
                  cache.put(event.request, responseToCache);
                } catch (error) {
                  console.error('Error putting in cache:', error);
                }
              })
              .catch(error => {
                console.error('Cache open error:', error);
              });

            return response;
          })
          .catch((error) => {
            console.log('Fetch failed; returning offline page instead.', error);
            
            // For navigation requests, show the offline page
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html')
                .then(response => {
                  if (response) {
                    return response;
                  }
                  // Fallback to index.html if offline.html not found
                  return caches.match('/index.html');
                })
                .catch(err => {
                  console.error('Error serving offline fallback:', err);
                  return new Response('You are offline. Please check your internet connection.', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: new Headers({
                      'Content-Type': 'text/html'
                    })
                  });
                });
            }
            
            // For non-navigation requests like images, scripts, etc.
            return new Response('Network error occurred', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});