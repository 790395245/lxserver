const CACHE_NAME = 'lx-music-web-v1';
const ASSETS_TO_CACHE = [
    '/music/',
    '/music/index.html',
    '/music/style.css',
    '/music/app.js',
    '/music/lyric-parser.js',
    '/music/lyric-utils.js',
    '/music/js/quality.js',
    '/music/js/user_sync.js',
    '/music/js/batch_pagination.js',
    '/music/js/single_song_ops.js',
    '/music/js/pwa.js',
    '/music/assets/logo.svg',
    '/music/assets/tailwindcss.js',
    '/music/assets/fontawesome/css/all.min.css',
    '/music/js/crypto-js.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                // Fallback or specific handling if needed
            });
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
