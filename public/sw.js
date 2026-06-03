const CACHE_NAME = 'vms-saha-v2';
const STATIC_ASSETS = ['/', '/mobile/', '/css/main.css?v=2'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

// ─── Push Notification Handler ───
self.addEventListener('push', (event) => {
    let data = { title: 'VMS Bildirim', body: 'Yeni bir bildirim var.', url: '/mobile/' };
    try {
        data = event.data.json();
    } catch(e) {
        data.body = event.data ? event.data.text() : data.body;
    }
    const options = {
        body: data.body,
        icon: '/mobile/icon-192.png',
        badge: '/mobile/icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'vms-notification-' + Date.now(),
        data: { url: data.url || '/mobile/' },
        actions: [
            { action: 'open', title: 'Aç' },
            { action: 'close', title: 'Kapat' }
        ]
    };
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/mobile/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes('/mobile') && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
