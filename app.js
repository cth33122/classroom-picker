// 入口：视图分发、数据加载、service worker 注册

const APP_VERSION = 'v124';

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
  if(opts.reset&&name==='students'){state.studentDetail=null;state.studentExamExpand=false;viewRenderer('students')();}
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
window.addEventListener('load',async()=>{if('serviceWorker'in navigator){const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!window.__swReloaded){window.__swReloaded=true;location.reload();}});navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});}try{await reload();}catch(err){toast(`本地数据初始化失败：${err.message}`);}let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false;});$('#installBtn').addEventListener('click',async()=>{if(deferred){deferred.prompt();deferred=null;}});});
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

async function reload(){
  [state.students,state.history,state.absences,state.exams,state.examResults]=await Promise.all([DB.all('students'),DB.all('history'),DB.all('absences'),DB.all('exams'),DB.all('examResults')]);
  state.students.forEach(s=>{s.className=normalizeClassName(s.className);s.id=s.id||`${s.className}-${s.name}`;});
  state.examResults.forEach(r=>{if(r.result){r.result.className=normalizeClassName(r.result.className);r.identityKey=r.identityKey||`${r.result.className}-${r.result.name}`;}});
  for(const exam of state.exams){const storedTotal=Number(exam.totalScore);if(Number.isFinite(storedTotal)&&storedTotal>100)continue;const max=Math.max(...state.examResults.filter(r=>r.examId===exam.id).map(r=>Number(r.result?.score)||0),0);if(max>100){exam.totalScore=[120,150,160,180,200].find(n=>max<=n)||Math.ceil(max/10)*10;await DB.put('exams',exam);}}
  state.settings=mergeConfig(await DB.getSettings());
  // 恢复上次选择的班级（失效时退回第一个班级）
  const savedClass=normalizeClassName((await DB.all('meta')).find(x=>x&&x.id==='currentClass')?.value||'');
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
