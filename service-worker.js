'use strict';
// 更新任何核心檔案後請增加版本。以完整版本快取，避免新舊 JS/CSS 混用。
const CACHE_PREFIX = `quiet-pomodoro:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const CORE_FILES = ['./', './index.html', './style.css', './script.js', './manifest.json'];
const ICON_FILES = ['./icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_FILES);
    // 圖示屬非必要資源；即使漏傳圖示，核心離線快取仍能完成。
    await Promise.all(ICON_FILES.map(file => cache.add(file).catch(() => {})));
    // 不強制 skipWaiting：讓正在使用舊版的計時器完成，不中斷目前計時。
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const allowed = [...CORE_FILES, ...ICON_FILES].map(file => new URL(file, self.registration.scope).href);
  const cleanURL = new URL(url);
  cleanURL.search = '';
  // 不攔截同源其他應用或未知路徑。
  if (!allowed.includes(cleanURL.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cleanURL.href);
    if (cached) return cached;
    return fetch(event.request);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
