/* ============================================================
   ALŞ08 — Service Worker
   - Statik dosyaları önbelleğe alır
   - Çevrimdışı açılış sağlar
   - Ağ öncelikli strateji (geliştirme kolaylığı için)
   ============================================================ */

const CACHE_VERSION = 'als08-v1';
const CACHE_NAME = `p2p-transfer-${CACHE_VERSION}`;

// Önbelleğe alınacak dosyalar (göreli yollar — GitHub Pages alt klasöründe de çalışır)
const PRECACHE_URLS = [
  './',
  './index.html',
  './mobile.html',
  './manifest.json',
  './css/style.css',
  './css/desktop.css',
  './css/mobile.css',
  './js/common.js',
  './js/desktop.js',
  './js/mobile.js',
  './lib/peerjs.min.js',
  './lib/qrcode.min.js',
  './lib/html5-qrcode.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.ico'
];

// ---------- INSTALL ----------
self.addEventListener('install', (event) => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Tek tek ekle — biri başarısız olursa install'u bozmasın
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] önbelleğe alınamadı:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---------- ACTIVATE ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- FETCH ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sadece GET isteklerini ele al
  if (req.method !== 'GET') return;

  // PeerJS sinyalleşme istekleri (wss://, https://0.peerjs.com) önbelleğe alınmamalı
  const url = new URL(req.url);
  if (url.hostname.includes('peerjs.com') || url.protocol === 'wss:') {
    return; // tarayıcı kendi halletsin
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      // Önbellekte varsa hemen dön, arka planda güncelle (stale-while-revalidate)
      if (cached) {
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }

      // Önbellekte yoksa ağdan çek
      return fetch(req).then((res) => {
        // Sadece başarılı ve basic tipindeki yanıtları önbelleğe al
        if (res && res.status === 200 && res.type === 'basic') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      }).catch(() => {
        // Ağ da yoksa: navigasyon isteği için index.html'e düş
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        // Diğerleri için boş yanıt
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});

// ---------- MESSAGE (isteğe bağlı: manuel güncelleme) ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});