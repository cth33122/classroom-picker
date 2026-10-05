// 入口：视图分发、数据加载、service worker 注册

const APP_VERSION = 'v76';

$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{const wasStudents=state.view==='students';state.view=tab.dataset.view;if(tab.dataset.view==='students'&&wasStudents&&state.studentDetail)state.studentDetail=null;render();}));
window.addEventListener('load',async()=>{if('serviceWorker'in navigator){const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!window.__swReloaded){window.__swReloaded=true;location.reload();}});navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});}try{await reload();}catch(err){toast(`本地数据初始化失败：${err.message}`);}let deferred;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('#installBtn').hidden=false;});$('#installBtn').addEventListener('click',async()=>{if(deferred){deferred.prompt();deferred=null;}});});
// Keep exam stores in the reload transaction and preserve an empty previous exam for the oldest exam.

function render(){
  const globalSelect=$('#globalClassSelect');
  if(globalSelect){
    globalSelect.innerHTML=classes().map(c=>`<option value="${esc(c)}" ${c===state.currentClass?'selected':''}>${esc(c)}</option>`).join('')||'<option value="">暂无班级</option>';
    globalSelect.onchange=()=>{state.currentClass=globalSelect.value;state.selectedCandidate=null;state.candidates=[];state.studentDetail=null;render();};
  }
  const quick=$('#quickClasses');
  if(quick){
    quick.innerHTML=(state.settings.shortcutClasses||[]).map(c=>`<button class="secondary quick-class" data-quick-class="${esc(c)}">${esc(c)}</button>`).join('');
    $$('[data-quick-class]').forEach(b=>b.addEventListener('click',()=>{state.currentClass=b.dataset.quickClass;state.selectedCandidate=null;state.candidates=[];state.studentDetail=null;render();}));
  }
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${state.view}`));
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view));
  ({rollcall:renderRollcall,students:renderStudents,history:renderHistory,data:renderData,settings:renderSettings}[state.view])();
}

async function reload(){
  [state.students,state.history,state.absences,state.exams,state.examResults]=await Promise.all([DB.all('students'),DB.all('history'),DB.all('absences'),DB.all('exams'),DB.all('examResults')]);
  state.students.forEach(s=>{s.className=normalizeClassName(s.className);s.id=s.id||`${s.className}-${s.name}`;});
  state.examResults.forEach(r=>{if(r.result){r.result.className=normalizeClassName(r.result.className);r.identityKey=r.identityKey||`${r.result.className}-${r.result.name}`;}});
  for(const exam of state.exams){const storedTotal=Number(exam.totalScore);if(Number.isFinite(storedTotal)&&storedTotal>100)continue;const max=Math.max(...state.examResults.filter(r=>r.examId===exam.id).map(r=>Number(r.result?.score)||0),0);if(max>100){exam.totalScore=[120,150,160,180,200].find(n=>max<=n)||Math.ceil(max/10)*10;await DB.put('exams',exam);}}
  state.settings=mergeConfig(await DB.getSettings());state.currentClass=state.currentClass?normalizeClassName(state.currentClass):classes()[0]||'';
  const exams=orderedExams();if(!exams.some(e=>e.id===state.studentCurrentExamId))state.studentCurrentExamId=exams[0]?.id||'';
  if(!state.studentSelectionInitialized)state.studentPreviousExamId=previousExamIdFor(state.studentCurrentExamId);render();
}
