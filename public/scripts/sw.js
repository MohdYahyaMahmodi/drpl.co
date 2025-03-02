// Service Worker for drpl.co
const CACHE_NAME = 'drpl-cache-v6'; // Updated cache name to force refresh

// Assets to cache on install - use full paths based on your directory structure
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
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
  console.log('[ServiceWorker] Install started');
  console.log('[ServiceWorker] Assets to cache:', JSON.stringify(STATIC_ASSETS));
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Cache opened, preparing to add files');
        
        // First cache the offline page specifically
        console.log('[ServiceWorker] Attempting to cache /offline.html specifically');
        return cache.add('/offline.html')
          .then(() => {
            console.log('[ServiceWorker] SUCCESS: /offline.html cached successfully');
            
            // Log progress for each file
            const cachePromises = STATIC_ASSETS.filter(url => url !== '/offline.html').map(url => {
              return cache.add(url)
                .then(() => {
                  console.log(`[ServiceWorker] SUCCESS: Cached ${url}`);
                  return url; // Return the URL for successful caches
                })
                .catch(error => {
                  console.error(`[ServiceWorker] FAILED: Could not cache ${url}:`, error);
                  return null; // Return null for failed caches
                });
            });
            
            // Wait for all cache operations to complete
            return Promise.all(cachePromises)
              .then(results => {
                const successfulCaches = results.filter(Boolean);
                console.log('[ServiceWorker] Successfully cached files:', successfulCaches);
                
                // Check cache contents
                return cache.keys().then(requests => {
                  console.log('[ServiceWorker] Final cache contents:');
                  requests.forEach(request => {
                    console.log(`- ${request.url}`);
                  });
                });
              });
          })
          .catch(error => {
            console.error('[ServiceWorker] ERROR: Failed to cache /offline.html:', error);
            
            // Try alternative paths if the main one fails
            console.log('[ServiceWorker] Trying relative path "offline.html" instead');
            return cache.add('offline.html')
              .then(() => {
                console.log('[ServiceWorker] SUCCESS: cached offline.html with relative path');
                
                // Then proceed with other assets
                return cache.addAll(STATIC_ASSETS.filter(url => !url.includes('offline.html')))
                  .then(() => {
                    console.log('[ServiceWorker] Cached other assets');
                    
                    // Check cache contents
                    return cache.keys().then(requests => {
                      console.log('[ServiceWorker] Final cache contents:');
                      requests.forEach(request => {
                        console.log(`- ${request.url}`);
                      });
                    });
                  });
              })
              .catch(innerError => {
                console.error('[ServiceWorker] CRITICAL ERROR: All attempts to cache offline page failed:', innerError);
                console.error('[ServiceWorker] Will continue with other assets, but offline page may not work');
                
                // Continue anyway to cache other assets
                return cache.addAll(STATIC_ASSETS.filter(url => !url.includes('offline.html')))
                  .then(() => {
                    // Check cache contents
                    return cache.keys().then(requests => {
                      console.log('[ServiceWorker] Final cache contents despite offline.html failure:');
                      requests.forEach(request => {
                        console.log(`- ${request.url}`);
                      });
                    });
                  });
              });
          });
      })
      .then(() => {
        console.log('[ServiceWorker] Installation complete, skipping waiting');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[ServiceWorker] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        console.log('[ServiceWorker] Found caches:', cacheNames);
        return Promise.all(
          cacheNames.filter((name) => {
            return name !== CACHE_NAME;
          }).map((name) => {
            console.log('[ServiceWorker] Deleting old cache:', name);
            return caches.delete(name);
          })
        );
      })
      .then(() => {
        console.log('[ServiceWorker] All old caches cleared');
        
        // List all current caches to verify
        return caches.keys().then(currentCaches => {
          console.log('[ServiceWorker] Current caches after cleanup:', currentCaches);
        });
      })
      .then(() => {
        console.log('[ServiceWorker] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Helper function to check if a request is a navigation request
function isNavigationRequest(request) {
  return (request.mode === 'navigate' || 
         (request.method === 'GET' && 
          request.headers.get('accept') && 
          request.headers.get('accept').includes('text/html')));
}

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and socket connections
  if (event.request.method !== 'GET' || 
      event.request.url.includes('/server')) {
    return;
  }

  // For debugging - log navigation requests
  if (isNavigationRequest(event.request)) {
    console.log('[ServiceWorker] Navigation request:', event.request.url);
  }

  event.respondWith(
    // Try the cache first
    caches.match(event.request)
      .then((response) => {
        // Return cached response if found
        if (response) {
          console.log('[ServiceWorker] Serving from cache:', event.request.url);
          return response;
        }

        console.log('[ServiceWorker] Not in cache, fetching from network:', event.request.url);
        
        // Clone the request - it's a one-time use object
        const fetchRequest = event.request.clone();
        
        // Try to fetch from network
        return fetch(fetchRequest)
          .then((response) => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              console.log('[ServiceWorker] Invalid response, not caching:', event.request.url);
              return response;
            }

            console.log('[ServiceWorker] Valid response, caching:', event.request.url);
            
            // Clone the response - it's a one-time use object
            const responseToCache = response.clone();

            // Cache the new resource
            caches.open(CACHE_NAME)
              .then((cache) => {
                try {
                  cache.put(event.request, responseToCache)
                    .then(() => {
                      console.log('[ServiceWorker] Successfully cached:', event.request.url);
                    });
                } catch (error) {
                  console.error('[ServiceWorker] Error putting in cache:', error);
                }
              })
              .catch(error => {
                console.error('[ServiceWorker] Cache open error:', error);
              });

            return response;
          })
          .catch((error) => {
            console.log('[ServiceWorker] Fetch failed:', error);
            console.log('[ServiceWorker] URL that failed:', event.request.url);
            console.log('[ServiceWorker] Request mode:', event.request.mode);
            console.log('[ServiceWorker] Is navigation:', isNavigationRequest(event.request));
            
            // For navigation requests, show the offline page
            if (isNavigationRequest(event.request)) {
              console.log('[ServiceWorker] Navigation request failed, serving offline page');
              
              // Try different paths for the offline page
              return caches.match('/offline.html')
                .then(response => {
                  if (response) {
                    console.log('[ServiceWorker] Found /offline.html in cache, serving it');
                    return response;
                  }
                  
                  console.log('[ServiceWorker] /offline.html not found, trying alternative path');
                  return caches.match('offline.html')
                    .then(altResponse => {
                      if (altResponse) {
                        console.log('[ServiceWorker] Found offline.html in cache, serving it');
                        return altResponse;
                      }
                      
                      // As a further fallback, try the absolute URL of offline.html
                      const offlineUrl = new URL('/offline.html', self.location.origin).href;
                      console.log('[ServiceWorker] Trying absolute URL:', offlineUrl);
                      
                      return caches.match(offlineUrl)
                        .then(absResponse => {
                          if (absResponse) {
                            console.log('[ServiceWorker] Found offline page with absolute URL');
                            return absResponse;
                          }
                          
                          // Last resort - fallback to index.html
                          console.log('[ServiceWorker] No offline page found, falling back to index.html');
                          return caches.match('/index.html')
                            .then(indexResponse => {
                              if (indexResponse) {
                                console.log('[ServiceWorker] Serving index.html as fallback');
                                return indexResponse;
                              }
                              
                              // Create a simple response if all else fails
                              console.log('[ServiceWorker] Creating basic offline response as last resort');
                              return new Response(
                                '<html><body><h1>You are offline</h1><p>Please check your connection.</p></body></html>', 
                                {
                                  status: 503,
                                  statusText: 'Service Unavailable',
                                  headers: new Headers({
                                    'Content-Type': 'text/html'
                                  })
                                }
                              );
                            });
                        });
                    });
                });
            }
            
            // For non-navigation requests
            console.log('[ServiceWorker] Non-navigation request failed, returning error response');
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