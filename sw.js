const CACHE_NAME = 'pwa-notes-v5';
const STATIC_CACHE = 'static-' + CACHE_NAME;
const DYNAMIC_CACHE = 'dynamic-' + CACHE_NAME;

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/offline.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/images/icon-192.png',
    '/images/icon-512.png',
    '/images/favicon.ico'
];

// ===== INSTALL =====
self.addEventListener('install', (event) => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
            .catch(error => console.error('[SW] Install error:', error))
    );
});

// ===== ACTIVATE =====
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    if (event.request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;
    
    // Статика - Cache First
    if (STATIC_ASSETS.includes(url.pathname) || url.pathname.match(/\.(css|js|png|jpg|ico|svg|woff2)$/)) {
        event.respondWith(cacheFirst(event.request));
        return;
    }
    
    // HTML - Network First
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request));
        return;
    }
    
    // API - Network First (не кешируем)
    if (url.pathname.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // По умолчанию
    event.respondWith(cacheFirst(event.request));
});

// ===== CACHE FIRST =====
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
        // Фоновое обновление
        fetch(request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    caches.open(STATIC_CACHE)
                        .then(cache => cache.put(request, networkResponse));
                }
            })
            .catch(() => {});
        
        return cachedResponse;
    }
    
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(STATIC_CACHE)
                .then(cache => cache.put(request, responseToCache));
        }
        
        return networkResponse;
    } catch (error) {
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        return new Response('Network error', { status: 503 });
    }
}

// ===== NETWORK FIRST =====
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE)
                .then(cache => cache.put(request, responseToCache));
        }
        
        return networkResponse;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        
        if (request.mode === 'navigate') {
            return caches.match('/offline.html');
        }
        return new Response('Network error', { status: 503 });
    }
}

// ===== PUSH =====
self.addEventListener('push', (event) => {
    console.log('[SW] Push received');
    
    let notificationData = {
        title: 'PWA Заметки',
        body: 'Новое уведомление',
        icon: '/images/icon-192.png',
        badge: '/images/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: '/' }
    };
    
    if (event.data) {
        try {
            const data = event.data.json();
            notificationData = { ...notificationData, ...data };
        } catch (e) {
            notificationData.body = event.data.text();
        }
    }
    
    event.waitUntil(
        self.registration.showNotification(notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            vibrate: notificationData.vibrate,
            data: notificationData.data
        })
    );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                for (const client of windowClients) {
                    if (client.url.includes(urlToOpen) && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

console.log('[SW] Ready');