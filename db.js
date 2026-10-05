const DB = (() => {
  // Version 2 repairs databases created by an earlier partial initialization.
  const NAME = 'class-rollcall-db', VERSION = 3;
  const STORES = ['students','history','settings','absences','meta','exams','examResults'];
  function open() { return new Promise((resolve,reject) => { const req=indexedDB.open(NAME,VERSION); req.onupgradeneeded=()=>{ const db=req.result; STORES.forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id',autoIncrement:name==='history'}); }); }; req.onsuccess=()=>{ const db=req.result; db.onversionchange=()=>db.close(); resolve(db); }; req.onerror=()=>reject(req.error); req.onblocked=()=>reject(new Error('数据库正在被旧页面占用，请关闭其他点名页面后刷新')); }); }
  async function tx(store, mode, fn) { const db=await open(); if(!db.objectStoreNames.contains(store)){ db.close(); throw new Error(`本地数据库缺少 ${store} 数据表，请刷新页面重试`); } return new Promise((resolve,reject)=>{ let t,s; try { t=db.transaction(store,mode); s=t.objectStore(store); } catch(e){ reject(e); return; } let result; try { result=fn(s); } catch(e){ reject(e); return; } t.oncomplete=()=>resolve(result); t.onerror=()=>reject(t.error); }); }
  const all = store => tx(store,'readonly',s=>new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }));
  function inferStore(value) {
    if(value && value.studentId && value.at) return 'history';
    if(value && value.studentId && value.date) return 'absences';
    if(value && value.examId && value.studentId) return 'examResults';
    if(value && value.name && value.date && value.importedAt) return 'exams';
    if(value && value.id === 'main') return 'settings';
    if(value && (value.name !== undefined || value.className !== undefined || value.score !== undefined)) return 'students';
    return 'meta';
  }
  // Accept the explicit (store, value) form and the legacy value-only form.
  const put = (store,value) => { if(value === undefined && store && typeof store === 'object') { value=store; store=inferStore(value); } return tx(store,'readwrite',s=>s.put(value)); };
  const clear = store => tx(store,'readwrite',s=>s.clear());
  const remove = (store, id) => tx(store,'readwrite',s=>s.delete(id));
  async function replace(store, values) { await clear(store); for(const value of values) await put(store,value); }
  async function getSettings() { const rows=await all('settings'); return rows[0] || {}; }
  return { open, all, put, clear, remove, replace, getSettings };
})();
