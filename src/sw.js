import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ── Workbox 프리캐시 (vite-plugin-pwa가 __WB_MANIFEST 주입) ──
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ── 런타임 캐시: Supabase API ──────────────────────────────
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({
    cacheName: 'supabase-api',
    networkTimeoutSeconds: 6,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  })
);

// ── 런타임 캐시: Google Fonts ──────────────────────────────
registerRoute(
  ({ url }) => url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com'),
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// ── 서비스워커 즉시 활성화 ─────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ── Web Push 수신 ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'TAGIN', body: '새 알림이 있습니다.' };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data.body = event.data?.text() ?? data.body;
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/dashboard.html' },
    tag: data.tag || 'tagin-push',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── 알림 클릭 → 해당 URL 열기 ─────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/dashboard.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // 이미 열린 탭이 있으면 포커스
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
