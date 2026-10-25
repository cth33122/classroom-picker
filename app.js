// 入口：视图分发、数据加载、service worker 注册

// 显示在“设置”页的当前版本；与 sw.js 里的 CACHE 名保持同步，两处一起改
const APP_VERSION = 'v222';

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
function goToView(name){
  const index=VIEW_NAMES.indexOf(name);if(index<0)return;
  viewIndex=index;
  highlightView(name);
  scrollTrackToPage(index);
  backEnterView(name);          // 记进返回栈（返回键用它决定“回哪一页”）
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
  if(opts.reset&&name==='students'){state.studentDetail=null;state.studentExamExpand=false;state.gradeAnalysisOpen=false;viewRenderer('students')();}
  goToView(name);
  if(opts.reset)scrollViewTop(name);
}
$$('.tab').forEach(tab=>tab.addEventListener('click',()=>setActiveView(tab.dataset.view,{reset:true})));
// 旋转屏幕/改变窗口宽度后，重新对齐到当前页
window.addEventListener('resize',()=>{viewIndex=Math.max(0,VIEW_NAMES.indexOf(state.view));scrollTrackToPage(viewIndex);});
// 滑动/滚动后同步当前页与标签高亮（页面不重绘，状态与滚动位置都保留）
trackEl?.addEventListener('scroll',()=>{
  const index=Math.max(0,Math.min(VIEW_NAMES.length-1,Math.round(trackEl.scrollLeft/trackWidth())));
  if(index!==viewIndex){viewIndex=index;highlightView(VIEW_NAMES[index]);}
},{passive:true});
window.addEventListener('load',async()=>{if('serviceWorker'in navigator){const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!window.__swReloaded){window.__swReloaded=true;location.reload();}});navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});}try{await reload();}catch(err){toast(`本地数据初始化失败：${err.message}`);}initBackGuard();let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false;});$('#installBtn').addEventListener('click',async()=>{if(deferred){deferred.prompt();deferred=null;}});});
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
}

// ---------- 安卓返回键接管（仅逻辑，不改界面） ----------
// 原理：Navigation API 的 navigate 事件在“后退”真正发生之前触发，且可取消（canIntercept）。
// 于是每次后退：先关最上层（弹窗 → 学生详情 → 上一页面），然后取消这次后退；
// 没有任何层可退（也就是站在首页）时，屏幕下方浮起一条纯文字气泡“再按一次返回键退出”
//   （几秒后自动消失）；再按一次返回＝直接退出。
// 不需要往历史里塞记录，也不需要在返回之后再补记录（后者在安卓上会被浏览器忽略）。
// 注意：Navigation API 在非安全上下文（http://192.168.x.x）里可能不存在；
// 不存在时本模块不启用，返回键保持浏览器原样。
const BACK_ROOT='rollcall';
const backViewStack=[BACK_ROOT];
let backReady=false;
let backArmed=false;          // 已经提醒过“再按一次退出”
const BACK_LOG=[];
function backLog(msg){
  try{
    BACK_LOG.push(msg);
    if(BACK_LOG.length>40)BACK_LOG.shift();
    console.log('[返回键] '+msg);
  }catch(err){}
}
function backCurrentView(){return backViewStack[backViewStack.length-1]||BACK_ROOT;}
function backModalCount(){return document.querySelectorAll('.modal-backdrop').length;}
function backAtFirstEntry(){
  try{
    const n=window.navigation;
    return Boolean(n&&n.currentEntry&&n.currentEntry.index===0);
  }catch(err){return false;}
}
// 记录页面切换（供“返回上一页”用）
function backEnterView(name){
  if(!backReady)return;
  if(name!==backCurrentView())backViewStack.push(name);
  backArmed=false;
  backLog('进入 '+name+'（栈 '+backViewStack.join('>')+'）');
}
// 站在第一条记录上时补一条“垫底记录”，让第一次后退有东西可退（从而能被拦截）
function backArm(){
  if(!backReady||backArmed)return;
  if(!backAtFirstEntry())return;
  try{
    history.pushState({backGuard:1},'',location.href);
    backLog('垫底记录已压入（等用户可能的后退）');
  }catch(err){backLog('垫底失败：'+(err&&err.message));}
}
function backCloseTopModal(){
  const modals=document.querySelectorAll('.modal-backdrop');
  if(!modals.length)return false;
  const top=modals[modals.length-1];
  const btn=top.querySelector('.modal-close');
  if(btn){btn.click();return true;}
  top.remove();
  if(!document.querySelectorAll('.modal-backdrop').length)document.body.classList.remove('modal-open');
  return true;
}
function backCloseDetail(){
  if(!state.studentDetail)return false;
  if(!closeStudentDetail())return false;
  backLog('退出学生详情 → '+backCurrentView());
  return true;
}
// ---------- 首页返回提醒：底部一条纯文字气泡 ----------
// 站在首页按返回时，屏幕下方浮起一条消息气泡“再按一次返回键退出”，几秒后自动消失。
// 没有按钮：气泡只是提醒，再按一次返回键才真的退出。
// 退一层；返回 true 表示“已处理，应取消这次后退”
function backHandleLayer(){
  if(backCloseTopModal()){backLog('关闭弹窗');return true;}
  if(backCloseDetail())return true;
  if(state.gradeAnalysisOpen){          // 成绩分析页：有来源就回那位学生的详情，否则回学生列表
    state.gradeAnalysisOpen=false;
    const fromDetail=state.gradeAnalysisFromDetail||'';
    state.gradeAnalysisFromDetail='';
    const view=document.getElementById('view-students');
    if(view)view.onscroll=null;
    if(fromDetail){
      state.studentDetail=fromDetail;
      state.studentExamExpand=false;
      renderStudents();
      backLog('退出成绩分析 → 学生详情');
    }else{
      renderStudents();
      scrollViewTop('students');
      backLog('退出成绩分析 → 学生列表');
    }
    return true;
  }
  if(backViewStack.length>1){
    backViewStack.pop();
    const target=backCurrentView();
    backLog('返回上一页 → '+target);
    goToView(target);
    return true;
  }
  return false;
}
function initBackGuard(){
  if(!window.navigation||typeof window.navigation.addEventListener!=='function'){
    backLog('没有 Navigation API（非 HTTPS/localhost），不接管返回键');
    return;
  }
  backReady=true;
  backLog('已接管返回键');
  window.navigation.addEventListener('navigate',event=>{
    try{
      if(event.navigationType!=='traverse')return;      // 只处理前进/后退
      if(!event.canIntercept)return;                    // 交给浏览器（例如离开页面）
      const here=window.navigation.currentEntry;
      if(here&&event.destination&&typeof event.destination.index==='number'&&event.destination.index>here.index){
        backLog('前进（不是返回），不拦截');
        return;
      }
      backLog('后退：视图 '+backCurrentView()+'、弹层 '+backModalCount()+'、已提醒 '+backArmed);
      if(backHandleLayer()){
        event.preventDefault();                          // 取消这次后退，界面已由我们处理
        backArmed=false;
        backLog('已处理并取消后退');
        return;
      }
      if(!backArmed){
        backArmed=true;
        backLog('提醒退出（再按一次才退出）');
        toast('再按一次返回键退出');
        return;                                          // 不取消：消耗掉那条垫底记录
      }
      backLog('放行（退出程序）');
    }catch(err){backLog('处理后退出错：'+(err&&err.message));}
  });
  // 用户每次触摸/点击后，若又回到第一条记录，就再补一条垫底记录（手势时机一定生效）
  document.addEventListener('pointerdown',()=>{try{backArm();}catch(err){}},{passive:true});
  backArm();
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
function resetViewState(){state.candidates=[];state.selectedCandidate=null;state.studentDetail=null;state.studentDetailFrom='';state.gradeAnalysisOpen=false;state.historyStudentId='';state.studentSelectionInitialized=false;state.studentCurrentExamId='';state.studentPreviousExamId='';state.pendingImport=null;state.seatClass='';state.seatLayout=null;}

// render() 现在会重绘全部页面，这里保留旧名字以兼容既有调用
function renderAllViews(){render();}

// 导入成绩/名册、恢复备份、清除数据后调用：重置临时状态 → 重新读库 → 重绘所有页面
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
