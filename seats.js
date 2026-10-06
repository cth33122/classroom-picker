// 座位表：数据模型、渲染、点名联动（编辑/换位/导入/着色在后续阶段接入）
const SEAT_COLS_DEFAULT = 8;
const SEAT_ROWS_MIN = 6;
const SEAT_ROWS_MAX = 9;

function seatClassStudents(){return state.students.filter(s=>s.className===state.currentClass);}

// 默认布局：8 列；排数按人数取 6–9；讲台左右各一个特殊位
function defaultSeatLayout(){
  const list=seatClassStudents();
  const cols=SEAT_COLS_DEFAULT;
  const rows=Math.max(SEAT_ROWS_MIN,Math.min(SEAT_ROWS_MAX,Math.ceil(Math.max(list.length,1)/cols)));
  const layout={id:state.currentClass,cols,rows,groupSize:2,rotate:'ltr',sideSeats:true,seats:[],updatedAt:new Date().toISOString()};
  for(let row=1;row<=rows;row++)for(let col=1;col<=cols;col++)layout.seats.push({id:`c${col}r${row}`,col,row,kind:'normal',studentId:null});
  layout.seats.push({id:'sideL',col:0,row:0,kind:'side',studentId:null,label:'讲台左'});
  layout.seats.push({id:'sideR',col:cols+1,row:0,kind:'side',studentId:null,label:'讲台右'});
  syncSeatGroups(layout);
  // 默认不按名册填座：座位表留空，等教师在“编辑座位”里安排后才启用
  return layout;
}
function seatGroupNumber(layout,col){const size=Number(layout.groupSize)||2;return size>0?Math.ceil(col/size):1;}
function syncSeatGroups(layout){layout.seats.forEach(s=>{s.group=s.kind==='side'?0:seatGroupNumber(layout,s.col);});return layout;}
// 按名册顺序填满空位（只填普通座位，讲台两侧留给教师手动安排）
function fillSeatsByName(layout,students,keepExisting=true){
  const list=(students||[]).slice();
  const taken=new Set(layout.seats.filter(s=>s.studentId).map(s=>s.studentId));
  const pool=keepExisting?list.filter(s=>!taken.has(s.id)):list;
  if(!keepExisting)layout.seats.forEach(s=>{if(s.kind==='normal')s.studentId=null;});
  const empty=layout.seats.filter(s=>s.kind==='normal'&&!s.studentId).sort((a,b)=>a.row-b.row||a.col-b.col);
  empty.forEach((seat,i)=>{if(pool[i])seat.studentId=pool[i].id;});
  return layout;
}
async function loadSeatLayout(force=false){
  const cls=state.currentClass;
  if(!cls){state.seatClass='';state.seatLayout=null;return null;}
  if(!force&&state.seatClass===cls&&state.seatLayout)return state.seatLayout;
  let layout=null;
  try{
    const rows=await DB.all('seats');
    layout=(rows||[]).find(r=>r&&r.id===cls)||null;
  }catch(err){
    layout=null;
    warnSeatStorage('读取失败：'+err.message);
  }
  if(!layout){
    layout=defaultSeatLayout();
    try{await DB.put('seats',layout);}
    catch(err){warnSeatStorage('保存失败：'+err.message);}
  }
  state.seatClass=cls;state.seatLayout=layout;
  return layout;
}
let seatStorageWarned=false;
function warnSeatStorage(detail){
  if(seatStorageWarned)return;
  seatStorageWarned=true;
  toast('座位表无法保存到本机（'+detail+'）——刷新后会恢复成按名册排列，请检查浏览器存储权限。');
}
async function saveSeatLayout(layout){
  layout=layout||state.seatLayout;if(!layout)return;
  layout.updatedAt=new Date().toISOString();
  state.seatLayout=layout;
  try{await DB.put('seats',layout);}catch(err){toast('座位表保存失败：'+err.message);}
}
function seatOfStudent(studentId){const layout=state.seatLayout;if(!layout||!studentId)return null;return layout.seats.find(s=>s.studentId===studentId)||null;}
function seatById(id){const layout=state.seatLayout;return layout?layout.seats.find(s=>s.id===id)||null:null;}
function seatLabel(seat){if(!seat)return '';if(seat.kind==='side')return seat.label||'讲台旁';return `第${seat.row}排 第${seat.col}列`;}
function seatGroupLabel(seat){
  if(!seat||seat.kind==='side'||!state.seatLayout)return '';
  return `第${seatGroupNumber(state.seatLayout,seat.col)}大组`;
}
// 候选卡片上显示的座位提示
function seatPositionText(studentId){
  const seat=seatOfStudent(studentId);
  if(!seat)return '未排座';
  const group=seatGroupLabel(seat);
  return seatLabel(seat)+(group?` · ${group}`:'');
}
function studentOfSeat(seat){return seat&&seat.studentId?state.students.find(s=>s.id===seat.studentId)||null:null;}

// 点名页点击座位（姓名）：进入对应学生的详情页
function openStudentDetailFromSeat(seatId){
  const seat=state.seatLayout&&state.seatLayout.seats?state.seatLayout.seats.find(s=>s.id===seatId):null;
  const stu=studentOfSeat(seat);
  if(!stu)return;
  openStudentDetail(stu.id);
}

function seatCellHtml(seat,stats,extraStyle,extraClass){
  if(!seat)return '<span class="seat seat-vacant"></span>';
  const stu=studentOfSeat(seat);
  const classes=['seat','seat-'+seat.kind];
  if(extraClass)classes.push(extraClass);
  if(!stu)classes.push('seat-vacant');
  if(stu&&state.candidates.some(c=>c.student.id===stu.id))classes.push('seat-cand');
  if(stu&&state.selectedCandidate===stu.id)classes.push('seat-sel');
  if(stu&&stu.focus)classes.push('seat-focus');
  if(stu&&stu.noCall)classes.push('seat-nocall');
  if(stu&&calledToday(stu.id))classes.push('seat-called');
  const color=stu?seatColorFor(stu,stats,state.seatColorMode||'none'):'';
  if(color)classes.push('seat-tinted');
  const text=stu?(stu.displayName||stu.name):(seat.kind==='side'?(seat.label||'讲台旁'):'');
  const title=stu?`${stu.name}（${seatLabel(seat)}）`:`${seatLabel(seat)}（空位）`;
  const styleParts=[color?`background:${color}`:'',extraStyle||''].filter(Boolean).join(';');
  const style=styleParts?` style="${styleParts}"`:'';
  return `<button type="button" class="${classes.join(' ')}" data-seat="${esc(seat.id)}" title="${esc(title)}"${style}>${esc(text)}</button>`;
}
function seatChartHtml(){
  if(!state.currentClass)return '<div class="empty">导入学生后即可排座位</div>';
  const layout=state.seatLayout;
  if(!layout)return '<div class="empty">正在准备座位表…</div>';
  const stats=classScoreStats();
  const hasSides=layout.sideSeats!==false;
  const groupSize=Number(layout.groupSize)||2;
  const template=seatGridTemplate(layout.cols,groupSize);
  const span=seatPodiumSpan(layout.cols,groupSize,hasSides);
  const podium=`<div class="seat-podium" style="grid-column:${span}">讲　台</div>`;
  const left=seatCellHtml(seatById('sideL'),stats,'grid-column:1'),right=seatCellHtml(seatById('sideR'),stats,'grid-column:-2');
  let rows='';
  // 教师视角：讲台在最下方，第1排紧挨讲台（内部数据仍是 row 1 = 最靠前）
  for(let row=layout.rows;row>=1;row--){
    let cells='';
    for(let col=1;col<=layout.cols;col++){
      if(col>1&&(col-1)%groupSize===0)cells+='<span class="seat-sep" aria-hidden="true"></span>';
      cells+=seatCellHtml(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col),stats);
    }
    rows+=`<div class="seat-row" style="grid-template-columns:${template}">${cells}</div>`;
  }
  return `<div class="seat-chart" style="--seat-cols:${layout.cols}">\
${rows}\
<div class="seat-podium-row" style="grid-template-columns:${template}">${hasSides?left:''}${podium}${hasSides?right:''}</div>\
</div>`;
}
// 座位姓名自适应字号：按“可用座位宽度 ÷ 最长文本”缩小，尽量完整显示（窄屏极限压缩）
function fitChartNames(chart,layout,maxFont){
  if(!chart||!layout)return;
  const cols=Math.max(1,Number(layout.cols)||1),groupSize=Number(layout.groupSize)||2;
  const seps=groupSize>0?Math.max(0,Math.ceil(cols/groupSize)-1):0;
  const css=getComputedStyle(chart);
  const gap=parseFloat(css.getPropertyValue('--seat-gap'))||parseFloat(css.columnGap)||4;
  const sep=parseFloat(css.getPropertyValue('--seat-sep'))||2;
  const width=chart.clientWidth;
  if(!width)return;
  const trackW=(width-(cols-1)*gap-seps*sep)/cols;
  if(!(trackW>0))return;
  // 真实可用文本宽度 = 轨道宽 - 边框 - 左右内边距
  const seatEl=chart.querySelector('.seat');
  let usable=trackW-4;
  if(seatEl){const sc=getComputedStyle(seatEl);usable=trackW-(parseFloat(sc.borderLeftWidth)+parseFloat(sc.borderRightWidth))-(parseFloat(sc.paddingLeft)+parseFloat(sc.paddingRight));}
  // 取所有座位实际显示的文本（学生姓名，或讲台两侧的标签）里最长的一个
  const texts=layout.seats.map(s=>{const stu=studentOfSeat(s);if(stu)return String(stu.displayName||stu.name||'');return s.kind==='side'?String(s.label||'讲台旁'):'';});
  const maxLen=Math.max(2,...texts.map(t=>t.trim().length));
  const size=Math.max(8,Math.min(maxFont||11,usable/maxLen));
  chart.style.setProperty('--seat-font',size.toFixed(2)+'px');
}
function fitSeatNames(){
  const roll=$('#view-rollcall .seat-chart');
  if(roll&&state.seatLayout)fitChartNames(roll,state.seatLayout,11);
  const ed=$('#seatModal .seat-chart');
  if(ed&&seatEditor)fitChartNames(ed,seatEditor.layout,12);
}
window.addEventListener('resize',()=>{fitSeatNames();});

// 组间用独立轨道画竖线：a|a|分隔|b|b|分隔|…
function seatGridTemplate(cols,groupSize){
  const parts=[];
  for(let col=1;col<=cols;col++){
    if(col>1&&(col-1)%groupSize===0)parts.push('var(--seat-sep,2px)');
    parts.push('minmax(0,1fr)');
  }
  return parts.join(' ');
}
function seatTrackIndex(col,groupSize){return col+Math.floor((col-1)/groupSize);}
function seatPodiumSpan(cols,groupSize,hasSides){
  if(!hasSides||cols<3)return '1 / -1';
  return `${seatTrackIndex(2,groupSize)} / ${seatTrackIndex(cols-1,groupSize)+1}`;
}

// ---------- 编辑座位（大弹窗；打开期间页面滑动手势失效） ----------
let seatEditor=null;   // { layout, selectedSeatId, selectedPoolId, dragging }
function copyLayout(layout){return JSON.parse(JSON.stringify(layout));}
function poolStudents(layout){
  const seated=new Set(layout.seats.filter(s=>s.studentId).map(s=>s.studentId));
  return seatClassStudents().filter(s=>!seated.has(s.id));
}
// 改列/排/组大小/方向/侧位：按 列,排 对齐尽量保留原位置上的学生
function applySeatLayoutOptions(layout,opts){
  const byPos=new Map(layout.seats.filter(s=>s.kind!=='side').map(s=>[s.col+','+s.row,{kind:s.kind,studentId:s.studentId}]));
  const sides=new Map(layout.seats.filter(s=>s.kind==='side').map(s=>[s.id,s]));
  const cols=Math.max(1,Math.min(12,Number(opts.cols)||layout.cols));
  const rows=Math.max(1,Math.min(12,Number(opts.rows)||layout.rows));
  layout.cols=cols;layout.rows=rows;
  layout.groupSize=[1,2,3].includes(Number(opts.groupSize))?Number(opts.groupSize):layout.groupSize;
  layout.rotate=opts.rotate==='rtl'?'rtl':'ltr';
  layout.sideSeats=!!opts.sideSeats;
  const seats=[];
  for(let row=1;row<=rows;row++){
    for(let col=1;col<=cols;col++){
      const old=byPos.get(col+','+row);
      seats.push({id:'c'+col+'r'+row,col:col,row:row,kind:old?old.kind:'normal',studentId:old?old.studentId:null});
    }
  }
  if(layout.sideSeats){
    seats.push(sides.get('sideL')||{id:'sideL',col:0,row:0,kind:'side',studentId:null,label:'讲台左'});
    seats.push(sides.get('sideR')||{id:'sideR',col:cols+1,row:0,kind:'side',studentId:null,label:'讲台右'});
  }
  layout.seats=seats;
  syncSeatGroups(layout);
  return layout;
}
function seatEditorCellHtml(seat,extraStyle,extraClass){
  const stu=seat.studentId?state.students.find(s=>s.id===seat.studentId):null;
  const classes=['seat','seat-'+seat.kind];
  if(extraClass)classes.push(extraClass);
  if(!stu)classes.push('seat-vacant');
  if(seatEditor&&seatEditor.selectedSeatId===seat.id)classes.push('seat-sel');
  const text=stu?(stu.displayName||stu.name):(seat.kind==='side'?(seat.label||'讲台旁'):'');
  const title=stu?stu.name+'（'+seatLabel(seat)+'）':seatLabel(seat)+'（空位）';
  const style=extraStyle?' style="'+extraStyle+'"':'';
  return '<button type="button" class="'+classes.join(' ')+'" data-eseat="'+esc(seat.id)+'" title="'+esc(title)+'"'+style+'>'+esc(text)+'</button>';
}
function seatEditorChartHtml(layout){
  const hasSides=layout.sideSeats!==false;
  // 关闭“讲台两侧”时不画任何占位，否则空占位仍会占住两侧的网格列
  const side=(id,col)=>{
    if(!hasSides)return '';
    const s=layout.seats.find(x=>x.id===id);
    return s?seatEditorCellHtml(s,'grid-column:'+col):'<span class="seat seat-vacant seat-side" style="grid-column:'+col+'"></span>';
  };
  let rows='';
  const groupSize=Number(layout.groupSize)||2;
  const template=seatGridTemplate(layout.cols,groupSize);
  const span=seatPodiumSpan(layout.cols,groupSize,hasSides);
  for(let row=layout.rows;row>=1;row--){
    let cells='';
    for(let col=1;col<=layout.cols;col++){
      if(col>1&&(col-1)%groupSize===0)cells+='<span class="seat-sep" aria-hidden="true"></span>';
      cells+=seatEditorCellHtml(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col));
    }
    rows+='<div class="seat-row" style="grid-template-columns:'+template+'">'+cells+'</div>';
  }
  return '<div class="seat-chart" style="--seat-cols:'+layout.cols+'">'
    +rows
    +'<div class="seat-podium-row" style="grid-template-columns:'+template+'">'+side('sideL',1)
    +'<div class="seat-podium" style="grid-column:'+span+'">讲　台</div>'
    +side('sideR',-2)+'</div>'
    +'</div>';
}
async function openSeatEditor(){
  await loadSeatLayout();
  if(!state.seatLayout){toast('当前班级还没有座位表');return;}
  seatEditor={layout:copyLayout(state.seatLayout),selectedSeatId:'',selectedPoolId:'',dragging:null,history:[]};
  document.body.classList.add('modal-open');
  renderSeatEditor();
}
// 编辑弹窗内的一切改动都即时保存；撤销靠历史快照栈
function commitSeatEditor(){
  if(!seatEditor)return;
  saveSeatLayout(seatEditor.layout);   // 同步 state.seatLayout 并写入本机数据库
}
function recordSeatSnapshot(snapshot){
  if(!seatEditor||!snapshot)return;
  seatEditor.history.push(snapshot);
  if(seatEditor.history.length>60)seatEditor.history.shift();
}
function pushSeatHistory(){if(seatEditor)recordSeatSnapshot(copyLayout(seatEditor.layout));}
function undoSeatEditor(){
  if(!seatEditor||!seatEditor.history.length){toast('没有可撤销的操作');return;}
  seatEditor.layout=seatEditor.history.pop();
  seatEditor.selectedSeatId='';seatEditor.selectedPoolId='';
  commitSeatEditor();
  renderSeatEditor();
  toast('已撤销上一步');
}
function closeSeatEditor(){
  document.body.classList.remove('modal-open');
  const m=$('#seatModal');if(m)m.remove();
  seatEditor=null;
  renderRollcall();
}

function renderSeatEditor(){
  if(!seatEditor)return;
  const layout=seatEditor.layout,pool=poolStudents(layout);
  let modal=$('#seatModal');
  if(!modal){modal=document.createElement('div');modal.id='seatModal';modal.className='modal-backdrop seat-modal';document.body.appendChild(modal);}
  const poolHtml=pool.length
    ?pool.map(s=>'<button type="button" class="seat-chip'+(seatEditor.selectedPoolId===s.id?' is-selected':'')+'" data-epool="'+esc(s.id)+'">'+esc(s.displayName||s.name)+'</button>').join('')
    :'<span class="hint">全部学生都已安排座位</span>';
  modal.innerHTML='<div class="modal-card seat-editor" role="dialog" aria-modal="true">'
    +'<div class="modal-header"><h2>编辑座位 · '+esc(state.currentClass)+'</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>'
    +'<div class="seat-editor-bar">'
    +'<label>列 <input id="seatColsInput" type="number" min="1" max="12" value="'+layout.cols+'"></label>'
    +'<label>排 <input id="seatRowsInput" type="number" min="1" max="12" value="'+layout.rows+'"></label>'
    +'<label><select id="seatGroupInput">'+[1,2,3].map(n=>'<option value="'+n+'"'+(layout.groupSize===n?' selected':'')+'>'+n+' 列一组</option>').join('')+'</select></label>'
    +'<label><select id="seatRotateInput"><option value="ltr"'+(layout.rotate!=='rtl'?' selected':'')+'>左→右轮换</option><option value="rtl"'+(layout.rotate==='rtl'?' selected':'')+'>右→左轮换</option></select></label>'
    +'<label class="seat-check"><input id="seatSideInput" type="checkbox"'+(layout.sideSeats?' checked':'')+'> 讲台两侧</label>'
    +'<button class="secondary" id="seatRotateBtn">换位</button>'
    +'<button class="secondary" id="seatImportBtn">导入</button>'
    +'<button class="secondary" id="seatExportBtn">导出</button>'
    +'<button class="secondary" id="seatUndoBtn"'+(seatEditor.history&&seatEditor.history.length?'':' disabled')+'>撤销</button>'
    +'</div>'
    +'<div class="seat-editor-body">'
    +'<div class="seat-editor-grid">'+seatEditorChartHtml(layout)+'</div>'
    +'<div class="seat-editor-pool">'
    +'<div class="seat-pool-head"><h3>未安排 <span class="badge">'+pool.length+'人</span></h3>'
    +'<button class="secondary" id="seatFillBtn">按名册填充</button></div>'
    +'<div class="seat-pool-list">'+poolHtml+'</div>'
    +'<p class="hint">点一个位置再点另一个位置可对调；点学生再点位置可落座；长按拖动同样可以对调，拖到本区域即腾空座位。</p>'
    +'</div></div></div>';
  bindSeatEditor();
  fitSeatNames();
  requestAnimationFrame(fitSeatNames);
}
function bindSeatEditor(){
  const modal=$('#seatModal');
  modal.querySelector('.modal-close').onclick=closeSeatEditor;
  $('#seatUndoBtn').onclick=undoSeatEditor;
  $('#seatFillBtn').onclick=()=>{pushSeatHistory();fillSeatsByName(seatEditor.layout,seatClassStudents());commitSeatEditor();renderSeatEditor();toast('已按名册填充座位');};
  $('#seatRotateBtn').onclick=rotateEditorGroups;
  $('#seatImportBtn').onclick=openSeatImport;
  $('#seatExportBtn').onclick=exportSeatXlsx;
  const applySize=()=>{
    pushSeatHistory();
    applySeatLayoutOptions(seatEditor.layout,{
      cols:$('#seatColsInput').value,rows:$('#seatRowsInput').value,
      groupSize:$('#seatGroupInput').value,rotate:$('#seatRotateInput').value,
      sideSeats:$('#seatSideInput').checked
    });
    commitSeatEditor();
    renderSeatEditor();
  };
  $('#seatColsInput').onchange=applySize;
  $('#seatRowsInput').onchange=applySize;
  $('#seatSideInput').onchange=applySize;
  $('#seatGroupInput').onchange=()=>{
    pushSeatHistory();
    seatEditor.layout.groupSize=[1,2,3].includes(Number($('#seatGroupInput').value))?Number($('#seatGroupInput').value):seatEditor.layout.groupSize;
    syncSeatGroups(seatEditor.layout);
    commitSeatEditor();
    renderSeatEditor();
  };
  $('#seatRotateInput').onchange=()=>{pushSeatHistory();seatEditor.layout.rotate=$('#seatRotateInput').value;commitSeatEditor();renderSeatEditor();};
  $$('#seatModal [data-eseat]').forEach(b=>{
    b.onclick=()=>seatEditorTapSeat(b.dataset.eseat);
    b.onpointerdown=e=>beginSeatDrag(e,b.dataset.eseat,'seat');
  });
  $$('#seatModal [data-epool]').forEach(b=>{
    b.onclick=()=>seatEditorTapPool(b.dataset.epool);
    b.onpointerdown=e=>beginSeatDrag(e,b.dataset.epool,'pool');
  });
}
function seatEditorTapSeat(seatId){
  const st=seatEditor;if(!st)return;
  const seat=st.layout.seats.find(s=>s.id===seatId);if(!seat)return;
  if(st.selectedPoolId){pushSeatHistory();seat.studentId=st.selectedPoolId;st.selectedPoolId='';st.selectedSeatId='';commitSeatEditor();renderSeatEditor();return;}
  if(!st.selectedSeatId){st.selectedSeatId=seatId;renderSeatEditor();return;}
  if(st.selectedSeatId===seatId){st.selectedSeatId='';renderSeatEditor();return;}
  const from=st.layout.seats.find(s=>s.id===st.selectedSeatId);
  if(from){pushSeatHistory();const tmp=from.studentId;from.studentId=seat.studentId;seat.studentId=tmp;commitSeatEditor();}
  st.selectedSeatId='';renderSeatEditor();
}
function seatEditorTapPool(studentId){
  const st=seatEditor;if(!st)return;
  st.selectedPoolId=st.selectedPoolId===studentId?'':studentId;
  st.selectedSeatId='';
  renderSeatEditor();
}

// 长按拖动：拖动期间跟手，落到座位/未安排区即完成对调或腾空
function beginSeatDrag(event,id,type){
  if(!seatEditor)return;
  if(event.button&&event.button!==0)return;
  const startX=event.clientX,startY=event.clientY;
  let armed=false;
  const seatOfId=()=>seatEditor.layout.seats.find(x=>x.id===id);
  const nameOfDrag=()=>{
    if(type==='seat'){const seat=seatOfId();const stu=seat&&seat.studentId?state.students.find(s=>s.id===seat.studentId):null;return stu?stu.name:(seat&&seat.kind==='side'?(seat.label||'讲台旁'):'空位');}
    const stu=state.students.find(s=>s.id===id);return stu?stu.name:'';
  };
  const timer=setTimeout(()=>{
    armed=true;
    const ghost=document.createElement('div');
    ghost.className='seat-drag-ghost';
    ghost.textContent=nameOfDrag();
    document.body.appendChild(ghost);
    seatEditor.dragging={id:id,type:type,ghost:ghost};
    moveSeatGhost(event.clientX,event.clientY);
  },200);
  const move=e=>{
    if(!armed){
      if(Math.abs(e.clientX-startX)>8||Math.abs(e.clientY-startY)>8){clearTimeout(timer);cleanup();}
      return;
    }
    moveSeatGhost(e.clientX,e.clientY);
    highlightSeatDropTarget(e.clientX,e.clientY);
  };
  const up=e=>{
    clearTimeout(timer);
    if(armed)dropSeatDrag(e.clientX,e.clientY);
    cleanup();
  };
  const cleanup=()=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    window.removeEventListener('pointercancel',up);
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
}
function moveSeatGhost(x,y){
  const g=seatEditor&&seatEditor.dragging&&seatEditor.dragging.ghost;
  if(!g)return;
  g.style.left=x+'px';
  g.style.top=y+'px';
}
function highlightSeatDropTarget(x,y){
  $$('#seatModal .drop-active').forEach(el=>el.classList.remove('drop-active'));
  const el=document.elementFromPoint(x,y);
  const target=el&&el.closest?el.closest('[data-eseat],.seat-editor-pool'):null;
  if(target)target.classList.add('drop-active');
}
function dropSeatDrag(x,y){
  const st=seatEditor;
  if(!st||!st.dragging)return;
  const drag=st.dragging;
  st.dragging=null;
  const el=document.elementFromPoint(x,y);
  const seatEl=el&&el.closest?el.closest('[data-eseat]'):null;
  const poolEl=el&&el.closest?el.closest('.seat-editor-pool'):null;
  if(drag.ghost)drag.ghost.remove();
  $$('#seatModal .drop-active').forEach(n=>n.classList.remove('drop-active'));
  const before=copyLayout(st.layout);
  let changed=false;
  if(seatEl){
    const targetSeat=st.layout.seats.find(s=>s.id===seatEl.dataset.eseat);
    if(targetSeat){
      if(drag.type==='seat'){
        const fromSeat=st.layout.seats.find(s=>s.id===drag.id);
        if(fromSeat&&fromSeat!==targetSeat){const tmp=fromSeat.studentId;fromSeat.studentId=targetSeat.studentId;targetSeat.studentId=tmp;changed=true;}
      }else{
        const seat=st.layout.seats.find(s=>s.studentId===drag.id);
        if(seat)seat.studentId=null;
        targetSeat.studentId=drag.id;changed=true;
      }
    }
  }else if(poolEl&&drag.type==='seat'){
    const fromSeat=st.layout.seats.find(s=>s.id===drag.id);
    if(fromSeat){fromSeat.studentId=null;changed=true;}
  }
  if(changed){recordSeatSnapshot(before);commitSeatEditor();}
  renderSeatEditor();
}

// ---------- 手动大组轮换 ----------
function movableGroups(layout){
  const groups=new Map();
  layout.seats.filter(s=>s.kind==='normal').forEach(s=>{
    const g=seatGroupNumber(layout,s.col);
    if(!groups.has(g))groups.set(g,[]);
    groups.get(g).push(s);
  });
  const keys=[...groups.keys()].sort((a,b)=>a-b);
  keys.forEach(g=>groups.get(g).sort((a,b)=>a.row-b.row||a.col-b.col));
  return {keys,groups};
}
// 方向 ltr：g1→g2→…→最右→g1；rtl 反向。pinned / 讲台两侧不动
function rotateLayoutGroups(layout){
  if(!layout)return false;
  const {keys,groups}=movableGroups(layout);
  if(keys.length<2)return false;
  const dir=layout.rotate==='rtl'?-1:1;
  const studentsByGroup=new Map(keys.map(g=>[g,groups.get(g).map(s=>s.studentId)]));
  keys.forEach((g,index)=>{
    const source=keys[(index-dir+keys.length)%keys.length];
    const incoming=studentsByGroup.get(source)||[];
    groups.get(g).forEach((seat,i)=>{seat.studentId=incoming[i]??null;});
  });
  return true;
}
function rotateEditorGroups(){
  if(!seatEditor)return;
  const current=seatEditor.layout,dir=current.rotate==='rtl'?'右→左':'左→右';
  if(movableGroups(current).keys.length<2){toast('至少需要两个大组才能轮换');return;}
  pushSeatHistory();
  rotateLayoutGroups(current);
  commitSeatEditor();
  renderSeatEditor();
  toast('已按“'+dir+'”轮换一次大组');
}

// ---------- 得分率色阶（30% 起算：低于 30% 按 30% 上色） ----------
const SEAT_SCORE_FLOOR=0.30;
function classScoreStats(){
  const floored=new Map(),percentile=new Map();
  const list=seatClassStudents().map(s=>({id:s.id,rate:averageScoreRate(s)}));
  const values=list.filter(x=>x.rate!==null).map(x=>Math.max(SEAT_SCORE_FLOOR,Math.min(1,x.rate)));
  const sorted=values.slice().sort((a,b)=>a-b);
  list.forEach(x=>{
    if(x.rate===null){floored.set(x.id,null);percentile.set(x.id,null);return;}
    const v=Math.max(SEAT_SCORE_FLOOR,Math.min(1,x.rate));
    floored.set(x.id,v);
    if(sorted.length<2){percentile.set(x.id,1);return;}
    const below=sorted.filter(s=>s<v).length;
    percentile.set(x.id,below/(sorted.length-1));
  });
  return {floored,percentile};
}
function seatColorFor(student,stats,mode){
  if(!student||!stats||mode==='none')return '';
  let t;
  if(mode==='pct'){
    // 百分位：0 = 班内最低 → 红，1 = 班内最高 → 绿（不再套用 30% 下限）
    const raw=stats.percentile.get(student.id);
    if(raw===null||raw===undefined)return '';
    t=raw;
  }else{
    // 绝对得分率：低于 30% 一律按 30% 起算
    const raw=stats.floored.get(student.id);
    if(raw===null||raw===undefined)return '';
    t=(raw-SEAT_SCORE_FLOOR)/(1-SEAT_SCORE_FLOOR);
  }
  t=Math.max(0,Math.min(1,t));
  return `hsl(${Math.round(120*t)},62%,74%)`;   // 0°红 → 120°绿
}
// ---------- 导入 / 导出座位表 ----------
function seatImportView(){return state.seatImportView==='normal'?'normal':'teacher';}
function parseSeatTableText(text){
  return String(text||'').split(/\r?\n/).filter(line=>line.trim()!=='').map(line=>line.split(/\t|,|，|\|/).map(v=>v.trim()));
}
function isSeatListFormat(rows){
  const head=(rows[0]||[]).map(v=>String(v));
  return head.some(v=>/列/.test(v))&&head.some(v=>/排/.test(v))&&head.some(v=>/姓名|学生/.test(v));
}
function seatMarker(text){
  const t=String(text||'').trim();
  if(!t)return null;
  if(/^(讲台左|台左|左讲台)/.test(t))return {side:'sideL'};
  if(/^(讲台右|台右|右讲台)/.test(t))return {side:'sideR'};
  if(/^(讲台|黑板)$/.test(t))return {podium:true};
  if(/^(空|空位|-|—|无)$/.test(t))return {empty:true};
  return null;
}
function stripSideLabel(text){return String(text||'').replace(/^(讲台左|台左|左讲台|讲台右|台右|右讲台)[:：]?/,'').trim();}
// 把矩阵/清单整理成 {cols,rows,grid,sideL,sideR}（教师视角：Excel 最后一行＝第1排）
function normalizeSeatRows(rows,view){
  let list=[];
  if(isSeatListFormat(rows)){
    const head=rows[0].map(v=>String(v));
    const idxOf=re=>head.findIndex(v=>re.test(v));
    const iCol=idxOf(/列/),iRow=idxOf(/排/),iName=idxOf(/姓名|学生/),iSeat=idxOf(/座位/);
    let maxCol=0,maxRow=0,entries=[];
    rows.slice(1).forEach(r=>{
      const marker=seatMarker(r[iSeat]||r[iCol]);
      const name=String(r[iName]||'').trim();
      if(marker&&marker.side){entries.push({side:marker.side,name:name||stripSideLabel(r[iSeat]||r[iCol])});return;}
      const col=Number(String(r[iCol]||'').replace(/[^0-9]/g,'')),row=Number(String(r[iRow]||'').replace(/[^0-9]/g,''));
      if(!col||!row)return;
      maxCol=Math.max(maxCol,col);maxRow=Math.max(maxRow,row);
      entries.push({col,row,name});
    });
    const grid=Array.from({length:maxRow},()=>Array.from({length:maxCol},()=>''));
    entries.forEach(e=>{if(e.col&&e.row)grid[e.row-1][e.col-1]=e.name;});
    const sideL=entries.find(e=>e.side==='sideL'),sideR=entries.find(e=>e.side==='sideR');
    return {cols:maxCol,rows:maxRow,grid,sideL:sideL?sideL.name:null,sideR:sideR?sideR.name:null};
  }
  let sideL=null,sideR=null;
  const body=[];
  rows.forEach(line=>{
    const markers=line.map(seatMarker);
    if(markers.some(m=>m&&(m.side||m.podium))){
      line.forEach((cell,i)=>{const m=markers[i];if(!m)return;if(m.side==='sideL')sideL=stripSideLabel(cell)||null;if(m.side==='sideR')sideR=stripSideLabel(cell)||null;});
      return;
    }
    body.push(line.map(cell=>String(cell||'').trim()));
  });
  if(view!=='normal')body.reverse();
  const rowsCount=Math.max(1,Math.min(12,body.length)),cols=Math.max(1,Math.min(12,Math.max(...body.map(l=>l.length),1)));
  const grid=Array.from({length:rowsCount},(_,r)=>Array.from({length:cols},(_,c)=>(body[r]&&body[r][c])||''));
  return {cols,rows:rowsCount,grid,sideL,sideR};
}
function findStudentByName(name){
  const target=String(name||'').trim();if(!target)return null;
  const list=seatClassStudents();
  return list.find(s=>(s.displayName||'')===target)||list.find(s=>s.name===target)||null;
}
// 用导入结果覆盖当前班级座位表；返回 {placed,unmatched}
function applySeatImport(normalized){
  const layout=state.seatLayout||defaultSeatLayout();
  const seats=[];
  const unmatched=[];
  for(let row=1;row<=normalized.rows;row++){
    for(let col=1;col<=normalized.cols;col++){
      const name=normalized.grid[row-1][col-1];
      let studentId=null;
      const marker=seatMarker(name);
      if(name&&!(marker&&marker.empty)){
        const stu=findStudentByName(name);
        if(stu)studentId=stu.id;else unmatched.push(name);
      }
      seats.push({id:'c'+col+'r'+row,col:col,row:row,kind:'normal',studentId:studentId});
    }
  }
  const sideName=normalized.sideL,sideNameR=normalized.sideR;
  if(sideName||sideNameR||layout.sideSeats){
    const leftId=sideName?((findStudentByName(sideName)||{}).id||null):null;
    const rightId=sideNameR?((findStudentByName(sideNameR)||{}).id||null):null;
    if(sideName&&!leftId)unmatched.push(sideName);
    if(sideNameR&&!rightId)unmatched.push(sideNameR);
    seats.push({id:'sideL',col:0,row:0,kind:'side',studentId:leftId,label:'讲台左'});
    seats.push({id:'sideR',col:normalized.cols+1,row:0,kind:'side',studentId:rightId,label:'讲台右'});
    layout.sideSeats=true;
  }
  layout.cols=normalized.cols;layout.rows=normalized.rows;layout.seats=seats;
  syncSeatGroups(layout);
  state.seatLayout=layout;
  const placed=seats.filter(s=>s.studentId).length;
  return {placed,unmatched};
}
async function importSeatFile(file){
  let rows=[];
  const name=String(file.name||'').toLowerCase();
  if(name.endsWith('.xlsx')){const sheets=await parseXlsx(file);rows=(sheets&&sheets[0]&&sheets[0].rows)||[];}
  else rows=parseSeatTableText(await file.text());
  return finishSeatImport(rows);
}
async function finishSeatImport(rows){
  const normalized=normalizeSeatRows(rows,seatImportView());
  const {placed,unmatched}=applySeatImport(normalized);
  await saveSeatLayout(state.seatLayout);
  $('#seatImportModal')?.remove();
  if(seatEditor){seatEditor.layout=copyLayout(state.seatLayout);renderSeatEditor();}
  renderRollcall();
  toast('已导入座位表：'+placed+' 人落座'+(unmatched.length?'，'+unmatched.length+' 个名字没匹配到：'+unmatched.slice(0,3).join('、'):''));
}
async function exportSeatXlsx(){
  const layout=state.seatLayout;
  if(!layout){toast('还没有座位表');return;}
  if(typeof JSZip==='undefined'){toast('导出组件尚未加载，请刷新页面重试');return;}
  const nameOf=seat=>{const stu=studentOfSeat(seat);return stu?stu.name:'';};
  const grid=[];
  for(let row=1;row<=layout.rows;row++){
    const line=[];
    for(let col=1;col<=layout.cols;col++)line.push(nameOf(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col)||null));
    grid.push(line);
  }
  grid.reverse();   // 教师视角：第一排写在最后一行
  grid.push(['讲台左：'+nameOf(seatById('sideL')),...Array.from({length:Math.max(0,layout.cols-2)},()=>''),'讲台右：'+nameOf(seatById('sideR'))]);
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="座位表" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml',excelSheetXml(grid));
  const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='座位表-'+state.currentClass+'-'+localDate()+'.xlsx';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('座位表已导出（教师视角：第一排在最下面）');
}
function openSeatImport(){
  $('#seatImportModal')?.remove();
  const modal=document.createElement('div');
  modal.id='seatImportModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card seat-import-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>导入座位表</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="field"><label>Excel 视角</label>\
<select id="seatImportViewSel">\
<option value="teacher" ${seatImportView()!=='normal'?'selected':''}>教师视角（Excel 最后一行 = 第1排）</option>\
<option value="normal" ${seatImportView()==='normal'?'selected':''}>正常视角（Excel 第一行 = 第1排）</option>\
</select></div>\
<div class="field"><label>选择文件（.xlsx / .csv / .txt）</label>\
<label class="secondary file-pick">点此选择文件<input id="seatImportFile" type="file" accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream"></label></div>\
<div class="field"><label>或直接粘贴表格（每行一排，用 Tab/逗号分隔）</label>\
<textarea id="seatImportText" rows="6" placeholder="张三&#9;李四&#9;王五&#10;赵六&#9;孙七&#9;"></textarea></div>\
<p class="hint">支持矩阵式（按教室形状填写，讲台两侧写“讲台左：姓名 / 讲台右：姓名”）与清单式（表头含 列 / 排 / 姓名）。</p>\
<div class="actions"><button class="primary" id="seatImportPasteBtn">导入粘贴内容</button></div>\
</div>`;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick=()=>modal.remove();
  $('#seatImportViewSel').onchange=e=>{state.seatImportView=e.target.value;};
  $('#seatImportFile').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{await importSeatFile(file);}catch(err){toast('导入失败：'+err.message);}
  };
  $('#seatImportPasteBtn').onclick=async()=>{
    const text=$('#seatImportText').value;
    if(!text.trim()){toast('请先粘贴内容');return;}
    try{await finishSeatImport(parseSeatTableText(text));}catch(err){toast('导入失败：'+err.message);}
  };
}
