// 资源 URL 带上传版本号：升级后浏览器必然重新拉取，不再出现“改了样式但手机还跑旧文件”
const CACHE = 'class-rollcall-v151';
const V = '151';
const BASE = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './styles.css', './db.js', './algorithm.js', './importer.js', './exporter.js', './core.js', './seats.js', './questions.js', './reminder.js', './charts.js', './rollcall.js', './students.js', './history.js', './data.js', './settings.js', './app.js', './manifest.json', './vendor/jszip.min.js', './icons/icon-48.png', './icons/icon-72.png', './icons/icon-96.png', './icons/icon-144.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-192-maskable.png', './icons/icon-512-maskable.png']
  .map(path => new URL(path + (path.endsWith('.png') || path === './' ? '' : '?v=' + V), BASE).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('class-rollcall-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
// 网络优先：联网时总是取最新代码（避免更新后仍跑旧缓存），断网时回退到缓存。
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(cached => cached
      || (request.mode === 'navigate' ? caches.match(new URL('./index.html', BASE).href) : Response.error())))
  );
});
