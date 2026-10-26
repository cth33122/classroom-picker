// 资源 URL 带上传版本号：升级后浏览器必然重新拉取，不再出现“改了样式但手机还跑旧文件”
const CACHE = 'class-rollcall-v238';
const V = '238';
const BASE = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './styles.css', './db.js', './algorithm.js', './importer.js', './exporter.js', './core.js', './identity.js', './classes.js', './seats.js', './photos.js', './questions.js', './charts.js', './rollcall.js', './students.js', './analysis.js', './classanalysis.js', './history.js', './data.js', './settings.js', './app.js', './manifest.json', './vendor/jszip.min.js', './icons/icon-48.png', './icons/icon-72.png', './icons/icon-96.png', './icons/icon-144.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-192-maskable.png', './icons/icon-512-maskable.png']
  .map(path => new URL(path + (path.endsWith('.png') || path === './' ? '' : '?v=' + V), BASE).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('class-rollcall-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
// 网络优先：联网时总是取最新代码（避免更新后仍跑旧缓存），断网时回退到缓存。
// 注意：缓存里的 index.html 是带版本号的（./index.html?v=V），断网时按无参数地址查会查不到，
// 所以兜底也要用带版本号的那个地址，否则断网刷新会变成浏览器的错误页。
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const offlineIndex = new URL('./index.html?v=' + V, BASE).href;
  event.respondWith(
    fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(cached => cached
      || (request.mode === 'navigate' ? caches.match(offlineIndex) : Response.error())))
  );
});
