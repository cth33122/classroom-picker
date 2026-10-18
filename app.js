// 入口：视图分发、数据加载、service worker 注册

// 显示在“设置”页的当前版本；与 sw.js 里的 CACHE 名保持同步，两处一起改
const APP_VERSION = 'v194';

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
// 做法：真正的界面层级只在历史里占一条记录（视图那条），另用一条“守卫”记录接住返回键，
// 这样连续按返回能一层层往下退。滑动切页用 replaceState，免得一次滑动攒出好几条记录。
const NAV_ROOT='rollcall';
let navReady=false;       // 初始化完成前不动历史记录
let navApplying=false;    // 正在按历史记录恢复界面 → 不要再 push
let navConsuming=false;   // 我们自己调了 history.back() 去“吃掉”那条守卫记录
let navExitArmed=false;   // 已经提醒过、故意不再压守卫 → 下一次返回直接交给系统退出
let navModalCount=0;      // 当前弹层数量（MutationObserver 维护）
let navLevels=0;          // 当前位置之上还有几条记录（0 = 已经在最底那条上，再按就退出）

function navDepth(){return navModalCount;}                      // “层”只算弹窗；详情页算页面级
function navGuardOnTop(){const st=history.state;return Boolean(st&&st.guard);}
function navUrl(name){return '#'+name;}
function navPushView(name,extra){
  navExitArmed=false;
  try{history.pushState({v:name,...(extra||{})},'',navUrl(name));navLevels++;}catch(err){}
}
function navReplaceView(name){
  try{history.replaceState({v:name},'',navUrl(name));}catch(err){}
}
// 把“当前这条记录”补记成带详情页 id 的（点开学生详情时用）
function navMarkDetail(id){
  const st=history.state||{};
  try{history.replaceState({...st,v:state.view,d:id||null},'',navUrl(state.view));}catch(err){}
}
function navConsumeGuard(){
  if(navConsuming)return;
  navConsuming=true;
  try{history.back();}catch(err){navConsuming=false;}
}
// 该不该在栈顶压一条“守卫”：有弹窗时要；在根页面也要（这样返回键会被我们接住）
function navSyncGuard(){
  if(!navReady||navApplying||navConsuming)return;
  const want=navDepth()>0||state.view===NAV_ROOT;
  if(!want){navExitArmed=false;return;}
  // 只有“已经在最底下、什么都没开”时，提醒后的下一次返回才允许直接退出；
  // 一旦又打开了弹窗（或详情），必须重新压守卫，否则返回会误退出。
  if(navExitArmed&&navDepth()===0)return;
  if(navExitArmed)navExitArmed=false;
  if(!navGuardOnTop()){try{history.pushState({v:state.view,d:state.studentDetail||null,guard:1},'',navUrl(state.view));navLevels++;}catch(err){}}
}
// 界面变化后统一调用：手动关掉的弹窗要把它那条守卫记录吃掉，免得下一次返回“空按一下”
function navAfterChange(){
  if(!navReady||navApplying)return;
  if(navDepth()===0&&state.view!==NAV_ROOT&&navGuardOnTop()){navConsumeGuard();return;}
  navSyncGuard();
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
  const st=event.state||{};
  const fromView=state.view;                                                        // 这一按“从哪个页面退出”
  navLevels=Math.max(0,navLevels-1);                                                 // 往后退了一层
  if(navConsuming){navConsuming=false;navApplyEntry(st);navAfterChange();return;}    // 我们自己吃守卫
  if(navDepth()>0){navApplyEntry(st);navCloseTopLayer();navAfterChange();return;}     // 有弹窗先关弹窗
  navApplyEntry(st);
  // 本来就在根页面、又按了返回：提醒一次，且故意不压守卫 → 再按一次由系统退出
  if(state.view===NAV_ROOT&&navDepth()===0&&fromView===NAV_ROOT&&navLevels===0){
    navExitArmed=true;
    toast('再按一次返回键退出');
    return;
  }
  navAfterChange();
});
// 弹窗都是临时创建后 append 到 body：用 MutationObserver 统一感知开/关，不必改动那二十来处弹窗代码
function navWatchModals(){
  const isModal=n=>{
    if(!n||n.nodeType!==1)return false;
    if(n.classList&&n.classList.contains('modal-backdrop'))return true;
    return Boolean(n.querySelector&&n.querySelector('.modal-backdrop'));
  };
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
    }).observe(document.body,{childList:true,subtree:true});
  }catch(err){}
}
// iOS Safari 的后退缓存（bfcache）恢复时，界面要跟历史记录对齐
window.addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  navApplyEntry(history.state||{});
  navModalCount=$$('.modal-backdrop').length;
  navAfterChange();
});
// 启动：把初始视图写进当前记录；URL 带 #视图名 时按它打开（刷新后停在原页）
function navInit(){
  const hash=String(location.hash||'').replace(/^#/,'');
  const start=VIEW_NAMES.includes(hash)?hash:state.view;
  const base=start===NAV_ROOT?NAV_ROOT:NAV_ROOT;     // 底下永远垫一条“点名页”记录
  try{history.replaceState({v:base},'',navUrl(base));}catch(err){}
  navLevels=0;
  if(start!==state.view){navApplying=true;try{goToView(start);}finally{navApplying=false;}}
  if(start!==NAV_ROOT){try{history.pushState({v:start},'',navUrl(start));navLevels=1;}catch(err){}}   // 再压上真正的起始页
  navWatchModals();
  navModalCount=$$('.modal-backdrop').length;
  navReady=true;
  navSyncGuard();
}

function goToView(name){
  const index=VIEW_NAMES.indexOf(name);if(index<0)return;
  viewIndex=index;
  highlightView(name);
  scrollTrackToPage(index);
  if(!navApplying)navPushView(name);   // 主动切页 → 记一条历史，返回键才能退回来
  navSyncGuard();
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
  const index=Math.max(0,Math.min(VIEW_NAMES.length-1,Math.round(trackEl.scrollLeft/trackWidth())));
  if(index!==viewIndex){viewIndex=index;highlightView(VIEW_NAMES[index]);navReplaceView(VIEW_NAMES[index]);navSyncGuard();}
},{passive:true});
window.addEventListener('load',async()=>{if('serviceWorker'in navigator){const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!window.__swReloaded){window.__swReloaded=true;location.reload();}});navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});}try{await reload();}catch(err){toast(`本地数据初始化失败：${err.message}`);}navInit();let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false;});$('#installBtn').addEventListener('click',async()=>{if(deferred){deferred.prompt();deferred=null;}});});
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
