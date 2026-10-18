// 入口：视图分发、数据加载、service worker 注册
const BOOT_START=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
let navBootMs=0;

// 显示在“设置”页的当前版本；与 sw.js 里的 CACHE 名保持同步，两处一起改
const APP_VERSION = 'v196';

// ---------- 页面切换：五个页面并排在横向轨道上，可左右滑动 ----------
const VIEW_NAMES=['rollcall','students','history','data','settings'];
function viewElement(name){return document.getElementById('view-'+name);}
function viewRenderer(name){return {rollcall:renderRollcall,students:renderStudents,history:renderHistory,data:renderData,settings:renderSettings}[name];}
function scrollViewTop(name){const el=viewElement(name);if(el)el.scrollTop=0;}
// 横向分页：原生横向滚动 + 吸附（归位完全交给浏览器），点标签则瞬间到位
const trackEl=$('#viewTrack');
let viewIndex=Math.max(0,VIEW_NAMES.indexOf(state.view));
function trackWidth(){return trackEl?trackEl.clientWidth||1:1;}
function scrollTrackToPage(index){
  if(!trackEl)return;
  const max=(VIEW_NAMES.length-1)*trackWidth();
  const target=Math.max(0,Math.min(max,index*trackWidth()));
  if(Math.abs(trackEl.scrollLeft-target)>1)trackEl.scrollLeft=target;   // 直接到位，无动画
}
// ---------- 浏览器历史 / 安卓返回键 ----------
// 目标：系统返回键按“界面层级”一层层退 —— 有弹窗先关弹窗；在详情页退回到上一个页面；
// 只有在**点名页（根页面）且没有弹窗**时，返回才真正离开 App：第一次按给一句提醒，第二次按交给系统退出。
//
// 做法（尽量少的状态，只依赖浏览器自己知道的东西）：
//   · 启动时把最底那条记录标成 {v:根页面, bottom:1}；
//   · 切页面时 pushState 记一条 {v:页面}；
//   · 需要“接住返回键”时（有弹窗 / 在根页面）在栈顶压一条守卫记录 {guard:1}；
//   · 返回键落在守卫上 → 关掉一层（或提醒退出）；落在别的记录上 → 按记录恢复界面。
// 这样每个判断都来自 history.state，不依赖内存里另记的计数器，出问题也能自愈。
const NAV_ROOT='rollcall';
let navReady=false;        // 初始化完成前不动历史记录
let navApplying=false;     // 正在按历史记录恢复界面 → 不要再 push
let navConsuming=false;    // 我们主动 history.back() 去“吃掉”一条守卫记录
let navConsumeTimer=0;
let navExitArmed=false;    // 已经提醒过退出、且仍停在最底那条 → 下一次返回交给系统退出
let navModalCount=0;       // 当前弹层数量（MutationObserver 维护）
let navScrollGuard=0;      // 程序化滚动期间抑制“滑动切页”误判

function navDepth(){return navModalCount;}                                  // “层”只算弹窗；详情页算页面级
function navState(){return history.state||{};}
function navGuardOnTop(){return Boolean(navState().guard);}
function navBottomOnTop(){return Boolean(navState().bottom);}
function navUrl(name){return '#'+name;}
function navPush(st){
  try{history.pushState(st,'',navUrl(st.v||state.view));return true;}catch(err){return false;}
}
function navReplace(st){
  try{history.replaceState(st,'',navUrl(st.v||state.view));return true;}catch(err){return false;}
}
function navPushView(name){
  navExitArmed=false;
  navPush({v:name});
  navDebugUpdate();
}
function navReplaceView(name){
  navReplace({v:name});
  navDebugUpdate();
}
// 点开学生详情时，把当前这条记录补记成“学生页 + 打开着谁的详情”
function navMarkDetail(id){
  navReplace({...navState(),v:state.view,d:id||null});
  navDebugUpdate();
}
// 主动退一条（用于“手动关掉弹窗后把多余的那条守卫吃掉”）；带兜底定时器，避免卡死
function navConsumeGuard(){
  if(navConsuming)return;
  navConsuming=true;
  clearTimeout(navConsumeTimer);
  navConsumeTimer=setTimeout(()=>{navConsuming=false;navAfterChange();},400);   // 万一没等到 popstate 也能自愈
  try{history.back();}catch(err){navConsuming=false;clearTimeout(navConsumeTimer);}
}
function navPushGuard(){
  return navPush({v:state.view,d:state.studentDetail||null,guard:1});
}
// 保证“该有守卫的时候一定有守卫”：有弹窗要有；在根页面也要（除非刚提醒过、正停在最底那条）
function navEnsureGuard(){
  if(!navReady||navApplying||navConsuming)return;
  if(navGuardOnTop())return;
  if(navDepth()>0){navPushGuard();return;}
  if(state.view!==NAV_ROOT)return;
  if(!navBottomOnTop())return;                  // 根页面上但脚下还有历史：这一按应该正常回上一页，不压守卫
  if(navExitArmed)return;                       // 提醒过、且仍停最底那条 → 下一次返回交给系统退出
  navExitArmed=false;
  navPushGuard();
}
const navSyncGuard=navEnsureGuard;                // 兼容旧调用名
// 界面变化后统一调用：手动关掉的弹窗要把它的守卫记录吃掉，避免下一次返回“空按一下”
function navAfterChange(){
  if(!navReady||navApplying)return;
  if(navDepth()===0&&state.view!==NAV_ROOT&&navGuardOnTop()){navConsumeGuard();navDebugUpdate();return;}
  navEnsureGuard();
  navDebugUpdate();
}
// 按“落到的那条记录”恢复界面（返回/前进/bfcache 恢复都走这里，不再 push）
function navApplyEntry(st){
  const view=(st&&st.v&&VIEW_NAMES.includes(st.v))?st.v:state.view;
  const detail=(st&&st.d)||null;
  navApplying=true;
  try{
    if(view!==state.view)goToView(view);
    if(detail!==state.studentDetail){
      state.studentDetail=detail;state.studentExamExpand=false;renderStudents();
      const el=$('#view-students');if(el&&!detail)el.scrollTop=state.studentListScroll||0;
    }
  }finally{navApplying=false;}
}
// 关掉最上层的弹窗（尽量走它自己的关闭逻辑：有的要确认保存、有的要清理状态）
function navCloseTopLayer(){
  const modals=$$('.modal-backdrop');
  if(!modals.length)return false;
  const top=modals[modals.length-1];
  const btn=top.querySelector('.modal-close');
  if(btn){btn.click();return true;}
  top.remove();
  if(!$$('.modal-backdrop').length)document.body.classList.remove('modal-open');
  return true;
}
window.addEventListener('popstate',event=>{
  clearTimeout(navConsumeTimer);
  const st=event.state||{};
  const fromView=state.view;
  if(navConsuming){navConsuming=false;navApplyEntry(st);navAfterChange();return;}   // 我们自己吃守卫
  if(navDepth()>0){navApplyEntry(st);navCloseTopLayer();navAfterChange();return;}    // 有弹窗先关弹窗
  navApplyEntry(st);
  // 本来就在根页面、又按了返回：提醒一次；这里故意不再压守卫 → 再按一次由系统退出
  if(state.view===NAV_ROOT&&navDepth()===0&&fromView===NAV_ROOT&&navBottomOnTop()){
    navExitArmed=true;
    toast('再按一次返回键退出');
    navDebugUpdate();
    return;
  }
  navAfterChange();
});
// 弹窗都是临时创建后 append 到 body：用 MutationObserver 统一感知开/关，不必改动那二十来处弹窗代码
function navWatchModals(){
  // 只观察 body 的直接子节点：全仓 23 处弹窗都是 document.body.appendChild(模态框)，
  // 而各个页面的重绘发生在 .view 内部 —— 不监听 subtree 就不会被每次重绘触发，开销接近 0。
  const isModal=n=>Boolean(n&&n.nodeType===1&&n.classList&&n.classList.contains('modal-backdrop'));
  try{
    new MutationObserver(records=>{
      let touched=false;
      for(const r of records){
        for(const n of r.addedNodes)if(isModal(n))touched=true;
        for(const n of r.removedNodes)if(isModal(n))touched=true;
      }
      if(!touched)return;
      const n=$$('.modal-backdrop').length;
      if(n===navModalCount)return;
      navModalCount=n;
      navAfterChange();
    }).observe(document.body,{childList:true});   // ← 不再 subtree:true
  }catch(err){}
}
// iOS Safari 的后退缓存（bfcache）恢复时，界面要跟历史记录对齐
window.addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  navApplyEntry(navState());
  navModalCount=$$('.modal-backdrop').length;
  navAfterChange();
});
// ?debug=1：手机上直接看到历史状态（排查返回键用，不影响正常使用）
function navDebugOn(){return /[?&]debug=1/.test(location.search);}
function navDebugUpdate(){
  if(!navDebugOn())return;
  let box=document.getElementById('navDebugBox');
  if(!box){box=document.createElement('div');box.id='navDebugBox';box.className='nav-debug';document.body.appendChild(box);}
  const st=navState();
  const bits=[];
  if(st.v)bits.push('view:'+st.v);
  if(st.d)bits.push('detail');
  if(st.guard)bits.push('GUARD');
  if(st.bottom)bits.push('BOTTOM');
  box.textContent=`view=${state.view}  depth=${navDepth()}  exitArmed=${navExitArmed?1:0}  applying=${navApplying?1:0}  consuming=${navConsuming?1:0}\nhist=${history.length}  state=${bits.join(',')||'(空)'}  boot=${navBootMs}ms\nurl=${location.hash||'(无)'}`;
}
// 启动：把初始视图写进最底那条记录；URL 带 #视图名 时按它打开（刷新后停在原页）
function navInit(){
  navReady=false;navExitArmed=false;navConsuming=false;navApplying=false;
  clearTimeout(navConsumeTimer);
  const hash=String(location.hash||'').replace(/^#/,'');
  const start=VIEW_NAMES.includes(hash)?hash:state.view;
  navReplace({v:NAV_ROOT,bottom:1});                       // 最底那条永远标成“根页面”
  if(start!==state.view){navApplying=true;try{goToView(start);}finally{navApplying=false;}}
  if(start!==NAV_ROOT)navPush({v:start});                  // 直接打开某页时，再压上真正的起始页
  navWatchModals();
  navModalCount=$$('.modal-backdrop').length;
  navReady=true;
  navEnsureGuard();
  navDebugUpdate();
}

function goToView(name){
  const index=VIEW_NAMES.indexOf(name);if(index<0)return;
  viewIndex=index;
  highlightView(name);
  navScrollGuard=Date.now()+250;       // 这一小段内的滚动事件是程序化切页造成的
  scrollTrackToPage(index);
  if(!navApplying)navPushView(name);   // 主动切页 → 记一条历史，返回键才能退回来
  navEnsureGuard();
}
function highlightView(name){
  state.view=name;
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${name}`));
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
}
// 点标签：滚到对应页；点“学生”标签时回到学生列表初始页并置顶
function setActiveView(name,options){
  const index=VIEW_NAMES.indexOf(name);if(index<0)return;
  const opts=options||{};
  const sameView=name===state.view;
  if(opts.reset&&name==='students'){state.studentDetail=null;state.studentExamExpand=false;viewRenderer('students')();navMarkDetail(null);}
  if(sameView&&!navApplying){
    // 点的是当前这个标签：只做归位，不新增历史记录（否则按一次返回像“没反应”）
    navApplying=true;
    try{goToView(name);}finally{navApplying=false;}
  }else{
    goToView(name);
  }
  if(opts.reset)scrollViewTop(name);
  navAfterChange();
}
$$('.tab').forEach(tab=>tab.addEventListener('click',()=>setActiveView(tab.dataset.view,{reset:true})));
// 旋转屏幕/改变窗口宽度后，重新对齐到当前页
window.addEventListener('resize',()=>{viewIndex=Math.max(0,VIEW_NAMES.indexOf(state.view));scrollTrackToPage(viewIndex);});
// 滑动/滚动后同步当前页与标签高亮（页面不重绘，状态与滚动位置都保留）
trackEl?.addEventListener('scroll',()=>{
  if(navScrollGuard>Date.now())return;      // 程序化切页引起的滚动，不算“用户滑动”
  const index=Math.max(0,Math.min(VIEW_NAMES.length-1,Math.round(trackEl.scrollLeft/trackWidth())));
  if(index!==viewIndex){viewIndex=index;highlightView(VIEW_NAMES[index]);navReplaceView(VIEW_NAMES[index]);navEnsureGuard();}
},{passive:true});
window.addEventListener('load',async()=>{if('serviceWorker'in navigator){const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!window.__swReloaded){window.__swReloaded=true;location.reload();}});navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});}try{await reload();}catch(err){toast(`本地数据初始化失败：${err.message}`);}navInit();navBootMs=Math.round(((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-BOOT_START);try{console.info(`[启动] 首次加载+首次渲染共 ${navBootMs} ms`);}catch(err){}navDebugUpdate();let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false;});$('#installBtn').addEventListener('click',async()=>{if(deferred){deferred.prompt();deferred=null;}});});
// Keep exam stores in the reload transaction and preserve an empty previous exam for the oldest exam.

function render(){
  const globalSelect=$('#globalClassSelect');
  if(globalSelect){
    globalSelect.innerHTML=classes().map(c=>`<option value="${esc(c)}" ${c===state.currentClass?'selected':''}>${esc(c)}</option>`).join('')||'<option value="">暂无班级</option>';
    globalSelect.onchange=()=>{setCurrentClass(globalSelect.value);state.selectedCandidate=null;state.candidates=[];state.studentDetail=null;render();};
  }
  const quick=$('#quickClasses');
  if(quick){
    quick.innerHTML=(state.settings.shortcutClasses||[]).map(c=>`<button class="secondary quick-class" data-quick-class="${esc(c)}">${esc(c)}</button>`).join('');
    $$('[data-quick-class]').forEach(b=>b.addEventListener('click',()=>{setCurrentClass(b.dataset.quickClass);state.selectedCandidate=null;state.candidates=[];state.studentDetail=null;render();}));
  }
  // 五个页面都保持渲染（滑动时两侧可见），重建时保留各自的纵向滚动位置
  VIEW_NAMES.forEach(name=>{
    const el=viewElement(name),keep=el?el.scrollTop:0;
    viewRenderer(name)();
    if(el)el.scrollTop=keep;
  });
 highlightView(state.view);
  viewIndex=Math.max(0,VIEW_NAMES.indexOf(state.view));
  scrollTrackToPage(viewIndex);
  navAfterChange();
}

async function reload(){
  [state.students,state.history,state.absences,state.exams,state.examResults]=await Promise.all([DB.all('students'),DB.all('history'),DB.all('absences'),DB.all('exams'),DB.all('examResults')]);
  state.photos=await loadPhotos();   // 学生头像（Blob），只在需要显示时才生成 objectURL
  state.students.forEach(s=>{s.className=normalizeClassName(s.className);s.id=s.id||`${s.className}-${s.name}`;});
  state.examResults.forEach(r=>{if(r.result){r.result.className=normalizeClassName(r.result.className);r.identityKey=r.identityKey||`${r.result.className}-${r.result.name}`;}});
  // 学生身份：幂等地给已有数据补上不可变 uid（第一次会写库；之后只补新产生的记录）。
  // 这一步不改任何既有字段与界面行为，代码里仍全部用旧 id 认人。
  try{
    const ident=await ensureStudentUids({students:state.students,history:state.history,absences:state.absences,examResults:state.examResults});
    if(ident.migrated){
      if(ident.nextStudents)state.students=ident.nextStudents;
      if(ident.nextHistory)state.history=ident.nextHistory;
      if(ident.nextAbsences)state.absences=ident.nextAbsences;
      if(ident.nextResults)state.examResults=ident.nextResults;
      // 头像记录只是多了 studentUid 字段，重建内存映射即可（不重新读 blob，objectURL 缓存不受影响）
      if(ident.nextPhotos)state.photos=Object.fromEntries(ident.nextPhotos.map(p=>[p.id,p]));
      if(ident.firstTime){
        const extra=ident.orphans?`；${ident.orphans} 条旧记录没对上学生（已保留，未删除）`:'';
        toast(`已为学生建立稳定身份：${ident.students} 人${extra}`);
      }
      if(ident.problems&&ident.problems.length)console.warn('身份自检发现问题：',ident.problems.slice(0,20));
    }
  }catch(err){console.warn('身份补齐失败（不影响使用）：',err);}
  for(const exam of state.exams){const storedTotal=Number(exam.totalScore);if(Number.isFinite(storedTotal)&&storedTotal>100)continue;const max=Math.max(...state.examResults.filter(r=>r.examId===exam.id).map(r=>Number(r.result?.score)||0),0);if(max>100){exam.totalScore=[120,150,160,180,200].find(n=>max<=n)||Math.ceil(max/10)*10;await DB.put('exams',exam);}}
  state.settings=mergeConfig(await DB.getSettings());
  // 恢复上次选择的班级（失效时退回第一个班级）
  const meta=await DB.all('meta');
  state.identity=meta.find(x=>x&&x.id==='identity')||null;   // 设置页“数据身份”那行只读状态
  state.classBatches=(meta.find(x=>x&&x.id==='classChanges')?.batches)||[];   // 班级变动批次：班级页提示核对/撤销
  const savedClass=normalizeClassName(meta.find(x=>x&&x.id==='currentClass')?.value||'');
  // 恢复座位表色阶选择（刷新/重开后仍保持原来的选择）
  state.seatColorMode=seatColorModeValue(meta.find(x=>x&&x.id==='seatColorMode')?.value||'none');
  // 恢复“座位表是否收起”（收起时候选头像会放大，刷新后不用每次再收一遍）
  state.seatCollapsed=meta.find(x=>x&&x.id==='seatCollapsed')?.value===true;
  const available=classes();
  const wanted=[state.currentClass,savedClass].filter(Boolean).map(v=>normalizeClassName(v)).find(v=>available.includes(v));
  state.currentClass=wanted||available[0]||'';
  await loadSeatLayout(true);
  const exams=orderedExams();if(!exams.some(e=>e.id===state.studentCurrentExamId))state.studentCurrentExamId=exams[0]?.id||'';
  if(!state.studentSelectionInitialized)state.studentPreviousExamId=previousExamIdFor(state.studentCurrentExamId);render();
}

// 丢弃与旧数据绑定的临时选择（候选、学生详情、考试选择、待确认导入）
function resetViewState(){state.candidates=[];state.selectedCandidate=null;state.studentDetail=null;state.studentDetailFrom='';state.historyStudentId='';state.studentSelectionInitialized=false;state.studentCurrentExamId='';state.studentPreviousExamId='';state.pendingImport=null;state.seatClass='';state.seatLayout=null;}

// render() 现在会重绘全部页面，这里保留旧名字以兼容既有调用
function renderAllViews(){render();}

// 导入成绩文件、恢复备份、清除数据后调用：重置临时状态 → 重新读库 → 重绘所有页面
async function refreshAfterDataImport(){
  const hadCandidates=state.candidates.length>0&&!state.selectedCandidate;
  resetViewState();
  await reload();
  renderAllViews();
  if(hadCandidates&&state.currentClass&&state.students.some(s=>s.className===state.currentClass))recommend();
}

// 强制更新：把页面用到的所有资源绕过浏览器缓存重新下载一遍，再刷新页面。
// 只覆盖缓存条目，不会删除本机数据（IndexedDB 里的学生、考试、点名记录等都不受影响）。
async function forceAppUpdate(){
  if(!confirm('将重新下载最新程序文件，然后刷新页面。\n不会清除学生、考试、点名记录等本机数据。\n\n继续吗？'))return;
  const btn=$('#forceUpdateBtn');
  const label=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='正在更新…';}
  try{
    const urls=[location.pathname+location.search];
    $$('script[src]').forEach(el=>urls.push(el.getAttribute('src')));
    $$('link[href]').forEach(el=>urls.push(el.getAttribute('href')));
    const list=[...new Set(urls.filter(Boolean))];
    await Promise.all(list.map(u=>fetch(u,{cache:'reload'}).catch(()=>null)));
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations().catch(()=>[]);
      await Promise.all(regs.map(r=>r.update().catch(()=>null)));
    }
    toast('已重新下载最新文件，正在刷新…');
    setTimeout(()=>location.reload(),700);
  }catch(err){
    if(btn){btn.disabled=false;btn.textContent=label;}
    toast(`更新失败：${err.message}`);
  }
}
