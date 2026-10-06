const DB = (() => {
// Version 2 修复早期初始化不全的库；Version 4 新增 seats（座位表）表。
const NAME = 'class-rollcall-db', VERSION = 4;
  const STORES = ['students','history','settings','absences','meta','exams','examResults','seats'];
  function open() { return new Promise((resolve,reject) => { const req=indexedDB.open(NAME,VERSION); req.onupgradeneeded=()=>{ const db=req.result; STORES.forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id',autoIncrement:name==='history'}); }); }; req.onsuccess=()=>{ const db=req.result; db.onversionchange=()=>db.close(); resolve(db); }; req.onerror=()=>reject(req.error); req.onblocked=()=>reject(new Error('数据库正在被旧页面占用，请关闭其他点名页面后刷新')); }); }
  async function tx(store, mode, fn) { const db=await open(); if(!db.objectStoreNames.contains(store)){ db.close(); throw new Error(`本地数据库缺少 ${store} 数据表，请刷新页面重试`); } return new Promise((resolve,reject)=>{ let t,s,settled=false; const close=()=>{if(!settled){settled=true;db.close();}}; try { t=db.transaction(store,mode); s=t.objectStore(store); } catch(e){db.close(); reject(e); return;} let result; try { result=fn(s); } catch(e){db.close(); reject(e); return;} t.oncomplete=()=>{close();resolve(result);}; t.onerror=()=>{close();reject(t.error||new Error('IndexedDB 事务失败'));}; t.onabort=()=>{close();reject(t.error||new Error('IndexedDB 事务已中止'));}; }); }
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
  // 批量写入：一个事务里写多条，避免成百上千次 open/transaction 把主线程占住
  const putMany = (store,values) => { const rows=Array.isArray(values)?values:[]; if(!rows.length) return Promise.resolve(0); return tx(store,'readwrite',s=>{ rows.forEach(value=>s.put(value)); return rows.length; }); };
  const clear = store => tx(store,'readwrite',s=>s.clear());
  const remove = (store, id) => tx(store,'readwrite',s=>s.delete(id));
  async function replace(store, values) { const rows=Array.isArray(values)?values:[]; await tx(store,'readwrite',s=>{ s.clear(); rows.forEach(value=>s.put(value)); return rows.length; }); }
  async function getSettings() { const rows=await all('settings'); return rows[0] || {}; }
  return { open, all, put, putMany, clear, remove, replace, getSettings };
})();
