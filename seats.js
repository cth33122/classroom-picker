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

function seatCellHtml(seat,stats,extraStyle,extraClass,chartId,ctx){
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
  const shown=seatTextForSeat(chartId&&document.getElementById?document.getElementById(chartId):null,state.seatLayout,seat,ctx||seatFitCtxFor('roll'));
  if(shown.trunc)classes.push('seat-trunc');
  const title=stu?`${stu.name}（${seatLabel(seat)}）`:`${seatLabel(seat)}（空位）`;
  const styleParts=[color?`background:${color}`:'',extraStyle||''].filter(Boolean).join(';');
  const style=styleParts?` style="${styleParts}"`:'';
  return `<button type="button" class="${classes.join(' ')}" data-seat="${esc(seat.id)}" title="${esc(shown.trunc?title+'（座位太小，已简称）':title)}"${style}>${esc(shown.text)}</button>`;
}
function seatChartHtml(ctx){
  if(!state.currentClass)return '<div class="empty">导入学生后即可排座位</div>';
  const layout=state.seatLayout;
  if(!layout)return '<div class="empty">正在准备座位表…</div>';
  const stats=classScoreStats();
  const hasSides=layout.sideSeats!==false;
  const groupSize=Number(layout.groupSize)||2;
  const template=seatGridTemplate(layout.cols,groupSize);
  const span=seatPodiumSpan(layout.cols,groupSize,hasSides);
  const podium=`<div class="seat-podium" style="grid-column:${span}">讲　台</div>`;
  const chartId='seatChartRoll';
  const left=seatCellHtml(seatById('sideL'),stats,'grid-column:1','',chartId,ctx),right=seatCellHtml(seatById('sideR'),stats,'grid-column:-2','',chartId,ctx);
  let rows='';
  // 教师视角：讲台在最下方，第1排紧挨讲台（内部数据仍是 row 1 = 最靠前）
  for(let row=layout.rows;row>=1;row--){
    let cells='';
    for(let col=1;col<=layout.cols;col++){
      if(col>1&&(col-1)%groupSize===0)cells+='<span class="seat-sep" aria-hidden="true"></span>';
      cells+=seatCellHtml(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col),stats,'','',chartId,ctx);
    }
    rows+=`<div class="seat-row" style="grid-template-columns:${template}">${cells}</div>`;
  }
  return `<div class="seat-chart" id="${chartId}" style="--seat-cols:${layout.cols}">\
${rows}\
<div class="seat-podium-row" style="grid-template-columns:${template}">${hasSides?left:''}${podium}${hasSides?right:''}</div>\
</div>`;
}
// ---------- 姓名自适应字号：先量真实座位宽，再决定“字号 + 能放几个字” ----------
// 下限 9.5px：三字姓名在 360px 屏上仍能完整显示；再挤就靠“横向滑动 + 保姓氏”，不把字压到看不清
const SEAT_FONT_MIN=9.5;
const SEAT_FONT_ESTIMATE=11;

// 姓名在特定字号下的实际渲染宽度（canvas 量宽会把 C 等西文 / 生僻字差异也算进去）
let seatMeasureCanvas=null;
function seatTextWidth(text,font){
  const t=String(text||'');
  if(!t)return 0;
  if(typeof document==='undefined')return t.length*SEAT_FONT_ESTIMATE;
  try{
    seatMeasureCanvas=seatMeasureCanvas||document.createElement('canvas');
    const mctx=seatMeasureCanvas.getContext('2d');
    if(!mctx)return t.length*SEAT_FONT_ESTIMATE;
    if(mctx.font!==font)mctx.font=font;
    return mctx.measureText(t).width;
  }catch(err){return t.length*SEAT_FONT_ESTIMATE;}
}

// 座位里能完整显示的文本：放得下就全名，放不下就退到“姓”（复姓取前两字，如 欧阳娜娜→欧阳）
function seatDisplayText(full,font,availPx,primary){
  const text=String(full||'').trim();
  const base=String(primary||'').slice(0,1);
  if(!text)return {text:'',trunc:false,wide:false};
  if(!(availPx>0))return {text:text,trunc:false,wide:true};
  const fullW=seatTextWidth(text,font);
  if(fullW<=availPx)return {text:text,trunc:false,wide:true};
  if(text.length<=1)return {text:text,trunc:false,wide:true};
  const cut=[...text][0]+([...text][1]||'');
  if(seatTextWidth(cut,font)<=availPx)return {text:cut,trunc:true,wide:false};
  return {text:base,trunc:true,wide:false};
}
// 量宽度前先摘掉缩写类，避免“已缩写的文字”反过来影响测量；字号/字体只取 family+size，
// 不走 getComputedStyle(el).font —— 那个字符串带 line-height 和可变字重，canvas 可能解析失败退回默认字体
function seatMeasureEl(el){
  const had=el.classList.contains('seat-trunc');
  if(had)el.classList.remove('seat-trunc');
  const cs=getComputedStyle(el);
  const fullW=seatTextWidth(el.textContent,measureFont(cs.fontSize,cs.fontFamily));
  if(had)el.classList.add('seat-trunc');
  return fullW;
}
function measureFont(size,family){
  const s=parseFloat(size);
  return (s>0?s:SEAT_FONT_ESTIMATE)+'px '+(family||'sans-serif');
}
// 本座位真正能放多少 px 文字：优先用上一次量到的真实值，首帧退回按可用宽度估算
function seatTextBudget(chart,layout){
  if(chart&&chart.dataset&&chart.dataset.seatFit)return Number(chart.dataset.seatFit)||0;
  if(chart&&layout){
    const cols=Math.max(1,Number(layout.cols)||1);
    const groupSize=Number(layout.groupSize)||2;
    const seps=groupSize>0?Math.max(0,Math.ceil(cols/groupSize)-1):0;
    const w=seatAvailWidth(chart);
    if(w>0){
      const cs=getComputedStyle(chart);
      const gap=parseFloat(cs.getPropertyValue('--seat-gap'))||2;
      const sep=parseFloat(cs.getPropertyValue('--seat-sep'))||1;
      const track=(w-(cols-1)*gap-seps*sep)/cols;
      if(track>0)return track-9;
    }
  }
  return 0;
}
// 一个座位最终显示的文本：能放全就全名，放不下退到“姓”，最后才截断（不再出现 X…）
// ctx 可传入 {font,budget}：同一次渲染里只量一次，避免每个座位都去 getComputedStyle
function seatTextForSeat(chart,layout,seat,ctx){
  const stu=studentOfSeat(seat);
  const full=stu?String(stu.displayName||stu.name||''):(seat.kind==='side'?String(seat.label||'讲台旁'):'');
  if(!full)return {text:'',trunc:false};
  if(!chart||!chart.ownerDocument)return {text:full,trunc:false};
  let font=ctx&&ctx.font,budget=ctx?ctx.budget:0;
  if(!font||!(budget>0)){
    const cfs=chart.ownerDocument.defaultView.getComputedStyle(chart);
    const size=parseFloat(cfs.getPropertyValue('--seat-font'))||SEAT_FONT_ESTIMATE;
    if(!font)font=measureFont(size,cfs.fontFamily);
    if(!(budget>0))budget=seatTextBudget(chart,layout);
  }
  const shown=seatDisplayText(full,font,budget,stu?stu.name:full);
  return {text:shown.text,trunc:shown.trunc};
}
// 按“谁最挤”定字号：整排能放下就 11px；放不下就跟着最挤的座位缩，但不再低于 SEAT_FONT_MIN
// 返回 {font,budget} 供渲染座位时复用，保证“量字号”和“定文本”用的是同一套基准
function fitChartNames(chart,layout,maxFont,maxNames){
  if(!chart||!layout)return null;
  const cols=Math.max(1,Number(layout.cols)||1),groupSize=Number(layout.groupSize)||2;
  const seps=groupSize>0?Math.max(0,Math.ceil(cols/groupSize)-1):0;
  const cap=maxFont||11,limit=Math.max(1,maxNames||3);
  const seats=chart.querySelectorAll('.seat');
  if(!seats.length)return null;
  const cs=getComputedStyle(chart);
  const gap=parseFloat(cs.getPropertyValue('--seat-gap'))||4;
  const sep=parseFloat(cs.getPropertyValue('--seat-sep'))||2;
  const width=seatAvailWidth(chart);
  if(!(width>0))return null;
  const sc=getComputedStyle(seats[0]);
  const gutters=(parseFloat(sc.borderLeftWidth)||0)+(parseFloat(sc.borderRightWidth)||0)+(parseFloat(sc.paddingLeft)||0)+(parseFloat(sc.paddingRight)||0);
  const trackW=(width-(cols-1)*gap-seps*sep)/cols;
  if(!(trackW>0))return null;
  let textW=Math.max(0,trackW-gutters);
  // 只量一次：每个座位“显示全名”需要多宽
  const widths=[];
  seats.forEach(el=>widths.push(seatMeasureEl(el)));
  widths.sort((a,b)=>a-b);
  if((widths[widths.length-1]||0)>textW){
    // 整排放不下：先缩字号；缩到下限还不够，就把宽度基准改成“第 limit 长”的姓名，只让个别长名缩写
    const floorW=textW*cap/SEAT_FONT_MIN;
    const pivot=widths[Math.max(0,widths.length-limit)]||0;
    textW=pivot>floorW?pivot:floorW;
  }
  const size=Math.min(cap,Math.max(SEAT_FONT_MIN,textW>0?(trackW-gutters)/textW*cap:cap));
  chart.style.setProperty('--seat-font',size.toFixed(2)+'px');
  // 记下“每个座位能放多少 px 文字”，渲染座位时据此决定显示全名还是缩写
  chart.dataset.seatFit=Math.round(textW);
  return {font:measureFont(size,cs.fontFamily),budget:textW};
}
// 取座位表的可用宽度：优先量容器的内层宽度，避免量到“已经被压缩过的”滚动容器本身
function seatAvailWidth(chart){
  const parent=chart.parentElement;
  if(parent){
    const pc=getComputedStyle(parent);
    const inner=parent.clientWidth-(parseFloat(pc.paddingLeft)||0)-(parseFloat(pc.paddingRight)||0)-(parseFloat(pc.borderLeftWidth)||0)-(parseFloat(pc.borderRightWidth)||0);
    if(inner>0)return inner;
  }
  return chart.clientWidth||0;
}
// 上一次量到的“字号 + 每个座位能放多少 px”：只放内存，不写进 layout（避免污染存档 JSON）
const seatFitCtx={roll:null,ed:null};
function seatFitCtxFor(which){return which==='ed'?seatFitCtx.ed:seatFitCtx.roll;}
function setSeatFitCtx(which,ctx){
  if(ctx)seatFitCtx[which==='ed'?'ed':'roll']=ctx;
  return ctx;
}
function fitSeatNames(){
  const out={roll:null,ed:null};
  const roll=$('#view-rollcall .seat-chart');
  if(roll&&state.seatLayout){out.roll=setSeatFitCtx('roll',fitChartNames(roll,state.seatLayout,11,3));observeSeatChart(roll,roll.parentElement||roll);}
  const ed=$('#seatModal .seat-chart');
  if(ed&&seatEditor){out.ed=setSeatFitCtx('ed',fitChartNames(ed,seatEditor.layout,11,3));observeSeatChart(ed,ed.parentElement||ed);}
  return out;
}
// 每个座位按“当前字号下能放多少 px”重写显示文本；返回是否有座位被缩写
function applySeatFit(chart,layout,ctx){
  if(!chart||!layout)return false;
  const seats=chart.querySelectorAll('.seat');
  let anyTrunc=false;
  seats.forEach(el=>{
    const seat=layout.seats.find(s=>s.id===el.dataset.eseat||s.id===el.dataset.seat);
    if(!seat)return;
    const shown=seatTextForSeat(chart,layout,seat,ctx);
    if(shown.trunc)anyTrunc=true;
    if(el.textContent!==shown.text)el.textContent=shown.text;
    el.classList.toggle('seat-trunc',shown.trunc);
  });
  return anyTrunc;
}
// 先按布局量字号，再按这个字号回填每个座位的显示文本（缩写在这里发生）
function refitSeats(){
  const ctx=fitSeatNames();
  const roll=$('#view-rollcall .seat-chart');
  if(roll&&state.seatLayout)applySeatFit(roll,state.seatLayout,ctx.roll);
  const ed=$('#seatModal .seat-chart');
  if(ed&&seatEditor)applySeatFit(ed,seatEditor.layout,ctx.ed);
}
// 尺寸一变（转屏、切分屏、键盘收起）立刻重算，不靠一次性测量
let seatResizeObserver=null;
const seatObservedTargets=new WeakSet();
const seatLastWidth=new WeakMap();
function observeSeatChart(chart,target){
  if(typeof ResizeObserver==='undefined'||!target)return;
  if(seatObservedTargets.has(target))return;
  seatObservedTargets.add(target);
  try{
    if(!seatResizeObserver)seatResizeObserver=new ResizeObserver(entries=>{
      let dirty=false;
      entries.forEach(e=>{
        const w=e.contentRect?e.contentRect.width:0;
        if(Math.abs((seatLastWidth.get(e.target)||0)-w)>1){seatLastWidth.set(e.target,w);dirty=true;}
      });
      if(dirty)refitSeats();
    });
    seatResizeObserver.observe(target);
    seatLastWidth.set(target,target.clientWidth||0);
  }catch(err){}
}
let seatFitPending=false;
function scheduleSeatFit(){
  if(seatFitPending)return;
  seatFitPending=true;
  requestAnimationFrame(()=>{seatFitPending=false;refitSeats();});
}
window.addEventListener('resize',scheduleSeatFit);
window.addEventListener('orientationchange',()=>{setTimeout(refitSeats,120);});

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
// 草稿模式：弹窗里所有改动只落在 seatEditor.layout 上，点“确认修改”才写回首页与数据库
let seatEditor=null;   // { layout, selectedSeatId, selectedPoolId, base, history, dirty }
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
function seatEditorCellHtml(seat,extraStyle,extraClass,ctx){
  const stu=seat.studentId?state.students.find(s=>s.id===seat.studentId):null;
  const classes=['seat','seat-'+seat.kind];
  if(extraClass)classes.push(extraClass);
  if(!stu)classes.push('seat-vacant');
  if(seatEditor&&seatEditor.selectedSeatId===seat.id)classes.push('seat-sel');
  const shown=seatTextForSeat(document.getElementById('seatChartEditor'),seatEditor?seatEditor.layout:null,seat,ctx||seatFitCtxFor('ed'));
  if(shown.trunc)classes.push('seat-trunc');
  const title=stu?stu.name+'（'+seatLabel(seat)+'）':seatLabel(seat)+'（空位）';
  const style=extraStyle?' style="'+extraStyle+'"':'';
  return '<button type="button" class="'+classes.join(' ')+'" data-eseat="'+esc(seat.id)+'" title="'+esc(shown.trunc?title+'（座位太小，已简称）':title)+'"'+style+'>'+esc(shown.text)+'</button>';
}
function seatEditorChartHtml(layout,ctx){
  const hasSides=layout.sideSeats!==false;
  // 关闭“讲台两侧”时不画任何占位，否则空占位仍会占住两侧的网格列
  const side=(id,col)=>{
    if(!hasSides)return '';
    const s=layout.seats.find(x=>x.id===id);
    return s?seatEditorCellHtml(s,'grid-column:'+col,'',ctx):'<span class="seat seat-vacant seat-side" style="grid-column:'+col+'"></span>';
  };
  let rows='';
  const groupSize=Number(layout.groupSize)||2;
  const template=seatGridTemplate(layout.cols,groupSize);
  const span=seatPodiumSpan(layout.cols,groupSize,hasSides);
  for(let row=layout.rows;row>=1;row--){
    let cells='';
    for(let col=1;col<=layout.cols;col++){
      if(col>1&&(col-1)%groupSize===0)cells+='<span class="seat-sep" aria-hidden="true"></span>';
      cells+=seatEditorCellHtml(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col),'','',ctx);
    }
    rows+='<div class="seat-row" style="grid-template-columns:'+template+'">'+cells+'</div>';
  }
  return '<div class="seat-chart" id="seatChartEditor" style="--seat-cols:'+layout.cols+'">'
    +rows
    +'<div class="seat-podium-row" style="grid-template-columns:'+template+'">'+side('sideL',1)
    +'<div class="seat-podium" style="grid-column:'+span+'">讲　台</div>'
    +side('sideR',-2)+'</div>'
    +'</div>';
}
async function openSeatEditor(){
  await loadSeatLayout();
  if(!state.seatLayout){toast('当前班级还没有座位表');return;}
  const base=copyLayout(state.seatLayout);
  seatEditor={layout:base,base:base,selectedSeatId:'',selectedPoolId:'',history:[],dirty:false};
  document.body.classList.add('modal-open');
  renderSeatEditor();
}
// 有改动 → 记一次快照（撤销用），并标记为“待确认”；真正的保存发生在点“确认修改”时
function commitSeatEditor(){
  if(!seatEditor)return;
  seatEditor.dirty=true;
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
  // 一路撤到底就是没改过，关窗时不必再问
  seatEditor.dirty=seatEditor.history.length>0;
  renderSeatEditor();
  toast(seatEditor.history.length?'已撤销上一步':'已回到打开时的状态');
}
// 点击 × / 点“保存”：有改动才弹确认框（返回编辑 / 放弃修改 / 确认修改）
function closeSeatEditor(){
  if(!seatEditor)return;
  if(!seatEditor.dirty){discardSeatEditor();return;}
  openSeatCloseDialog();
}
function saveSeatEditor(){
  if(!seatEditor)return;
  seatEditor.dirty=false;
  const layout=seatEditor.layout;
  discardSeatEditor();
  saveSeatLayout(layout)   // 同步 state.seatLayout 并写入本机数据库（失败时它自己会提示）
    .then(()=>toast('座位表已保存'))
    .catch(()=>{});
}
function discardSeatEditor(){
  document.body.classList.remove('modal-open');
  $('#seatCloseModal')?.remove();
  const m=$('#seatModal');if(m)m.remove();
  seatEditor=null;
  setSeatFitCtx('ed',null);   // 弹窗关了，缓存的编辑器量宽结果作废
  renderRollcall();
}
function openSeatCloseDialog(){
  const old=$('#seatCloseModal');
  if(old)old.remove();
  const dialog=document.createElement('div');
  dialog.id='seatCloseModal';
  dialog.className='modal-backdrop seat-close-backdrop';
  dialog.innerHTML='<div class="modal-card seat-close-card" role="dialog" aria-modal="true">'
    +'<button type="button" class="seat-close-x" aria-label="返回编辑">×</button>'
    +'<h3>座位表还没保存</h3>'
    +'<div class="seat-close-actions">'
    +'<button type="button" class="secondary" id="seatAbandonBtn"><strong>放弃修改</strong><small>丢弃这次的所有改动，座位表保持打开前的样子</small></button>'
    +'<button type="button" class="primary" id="seatSaveBtn"><strong>确认修改</strong><small>保存这次改动到本机，首页座位表和点名立刻按新安排生效</small></button>'
    +'</div>'
    +'<button type="button" class="seat-close-back" id="seatBackBtn">返回编辑（继续调整）</button>'
    +'</div>';
  document.body.appendChild(dialog);
  const back=()=>dialog.remove();
  dialog.querySelector('.seat-close-x').onclick=back;
  $('#seatBackBtn').onclick=back;
  $('#seatAbandonBtn').onclick=()=>discardSeatEditor();
  $('#seatSaveBtn').onclick=()=>saveSeatEditor();
  document.addEventListener('keydown',seatCloseDialogKeys);
}
function seatCloseDialogKeys(e){
  if(e.key!=='Escape')return;
  document.removeEventListener('keydown',seatCloseDialogKeys);
  $('#seatCloseModal')?.remove();
}

function renderSeatEditor(){
  if(!seatEditor)return;
  const layout=seatEditor.layout,pool=poolStudents(layout);
  let modal=$('#seatModal');
  if(!modal){modal=document.createElement('div');modal.id='seatModal';modal.className='modal-backdrop seat-modal';document.body.appendChild(modal);}
  const poolHtml=pool.length
    ?pool.map(s=>'<button type="button" class="seat-chip'+(seatEditor.selectedPoolId===s.id?' is-selected':'')+'" data-epool="'+esc(s.id)+'">'+esc(s.displayName||s.name)+'</button>').join('')
    :'';
  // 未安排区永远留一条“可落座”的空位：点中座位再点这里，就把学生从座位收回未安排
  const pickedSeat=seatEditor.selectedSeatId?seatEditor.layout.seats.find(s=>s.id===seatEditor.selectedSeatId):null;
  const pickedStu=pickedSeat&&pickedSeat.studentId?studentOfSeat(pickedSeat):null;
  const holderText=pickedStu?'点这里把 '+(pickedStu.displayName||pickedStu.name)+' 收回未安排':'先把座位上的学生收回到这里';
  const emptyHolder='<span class="seat-pool-drop'+(pickedSeat?' is-target':'')+'" id="seatPoolDrop">'+esc(holderText)+'</span>';
  const poolList=pool.length
    ?poolHtml+emptyHolder
    :emptyHolder;   // 没有未安排学生时，这一条就是“腾空座位”的落点
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
    +'<div class="seat-editor-grid">'+seatEditorChartHtml(layout,seatFitCtxFor('ed'))+'</div>'
    +'<div class="seat-editor-pool">'
    +'<div class="seat-pool-head"><h3>未安排 <span class="badge">'+pool.length+'人</span></h3>'
    +'<span class="seat-pool-buttons">'
    +'<button class="secondary" id="seatClearBtn">清空座位</button>'
    +'<button class="secondary" id="seatFillBtn">按名册填充</button>'
    +'</span></div>'
    +'<div class="seat-pool-list">'+poolList+'</div>'
    +'<p class="hint">点一个座位再点另一个座位：两人对调；点座位再点这里：把学生收回“未安排”；点学生的名字再点座位：直接落座。改动会在点“×”后确认保存。</p>'
    +'</div></div></div>';
  bindSeatEditor();
  refitSeats();
  requestAnimationFrame(refitSeats);
}
function bindSeatEditor(){
  const modal=$('#seatModal');
  modal.querySelector('.modal-close').onclick=closeSeatEditor;
  $('#seatUndoBtn').onclick=undoSeatEditor;
  $('#seatFillBtn').onclick=()=>{pushSeatHistory();fillSeatsByName(seatEditor.layout,seatClassStudents());commitSeatEditor();renderSeatEditor();toast('已按名册填充座位');};
  $('#seatClearBtn').onclick=clearEditorSeats;
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
  // 只保留点击换位：座位 → 座位 对调；座位 → 未安排 收回；未安排 → 座位 落座
  $$('#seatModal [data-eseat]').forEach(b=>{
    b.onclick=()=>seatEditorTapSeat(b.dataset.eseat);
  });
  $$('#seatModal [data-epool]').forEach(b=>{
    b.onclick=()=>seatEditorTapPool(b.dataset.epool);
  });
  const drop=$('#seatPoolDrop');
  if(drop)drop.onclick=()=>seatEditorTapPool('');
}
// 一键清空：只清座位上的学生，列/排/分组等版式保留（可撤销）
function clearEditorSeats(){
  const st=seatEditor;if(!st)return;
  const seated=st.layout.seats.filter(s=>s.studentId).length;
  if(!seated){toast('现在没有已安排的座位');return;}
  if(!confirm('把 '+seated+' 个已安排的学生全部收回“未安排”？\n座位版式（列、排、分组）会保留，可用“撤销”恢复。'))return;
  pushSeatHistory();
  st.layout.seats.forEach(s=>{s.studentId=null;});
  st.selectedSeatId='';st.selectedPoolId='';
  commitSeatEditor();
  renderSeatEditor();
  toast('已清空座位，学生都回到“未安排”');
}
function seatEditorTapSeat(seatId){
  const st=seatEditor;if(!st)return;
  const seat=st.layout.seats.find(s=>s.id===seatId);if(!seat)return;
  // 手上拿着“未安排”里的学生 → 直接落座
  if(st.selectedPoolId){
    pushSeatHistory();
    seat.studentId=st.selectedPoolId;
    st.selectedPoolId='';st.selectedSeatId='';
    commitSeatEditor();renderSeatEditor();
    return;
  }
  if(!st.selectedSeatId){st.selectedSeatId=seatId;renderSeatEditor();return;}
  if(st.selectedSeatId===seatId){st.selectedSeatId='';renderSeatEditor();return;}
  // 已选中一个座位 → 两个座位上的学生互换（其中一个可以是空位，等于把学生挪过去）
  const from=st.layout.seats.find(s=>s.id===st.selectedSeatId);
  if(from){pushSeatHistory();const tmp=from.studentId;from.studentId=seat.studentId;seat.studentId=tmp;commitSeatEditor();}
  st.selectedSeatId='';renderSeatEditor();
}
// 点未安排区：手上有座位就把这个座位腾空；否则选中/取消这个学生
function seatEditorTapPool(studentId){
  const st=seatEditor;if(!st)return;
  if(!studentId){
    if(st.selectedSeatId){
      const seat=st.layout.seats.find(s=>s.id===st.selectedSeatId);
      if(seat&&seat.studentId){
        pushSeatHistory();
        seat.studentId=null;
        commitSeatEditor();
        toast('已把该学生收回“未安排”');
      }
    }
    st.selectedSeatId='';st.selectedPoolId='';
    renderSeatEditor();
    return;
  }
  st.selectedPoolId=st.selectedPoolId===studentId?'':studentId;
  st.selectedSeatId='';
  renderSeatEditor();
}

// 长按拖拽换位已移除：只保留点击对调 / 落座 / 收回（避免手机上误触与滑动冲突）
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
function seatImportView(){return ['normal','flip','auto'].includes(state.seatImportView)?state.seatImportView:'auto';}
// 粘贴文本按行拆格：保留空单元格，否则矩阵里的空列会被吃掉
function parseSeatTableText(text){
  return String(text||'').split(/\r?\n/).filter(line=>line.trim()!=='').map(line=>line.split(/\t|\||,|，/).map(v=>v.trim()));
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

// ---------- 座位表内容识别 ----------
// 一列里能对上班内名单的姓名 ≤ 这个数（即只有 2 人及以下），就按“这一组人不齐/不是座位列”处理
const SEAT_COL_MIN_NAMES=3;
// 表格里常见“不是学生姓名”的单元格：讲台、黑板、门、窗、过道、组别名……
const SEAT_LABEL_RE=/(讲台|黑板|白板|屏幕|投影|门|窗|窗户|过道|走廊|通道|楼梯|饮水机|空调|卫生角|图书角|储物柜|多媒体|第一组|第二组|第三组|第四组|第五组|第六组|第七组|第八组|第九组|第十组|第1组|第2组|第3组|第4组|第5组|第6组|第7组|第8组|一组|二组|三组|四组|五组|六组|七组|八组|1组|2组|3组|4组|5组|6组|7组|8组|[一二三四五六七八九十0-9]+\s*大组)/;
function isSeatLabelCell(text){
  const t=String(text||'').trim();
  if(!t||seatMarker(t))return false;   // 空 / 讲台左右标签交给 seatMarker 处理
  return SEAT_LABEL_RE.test(t);
}
// 行尾空白补齐，保证每一行等宽（xlsx 里空单元格根本不占位，不补齐会量错列）
function padSeatRows(rows){
  const width=Math.max(1,...(rows||[]).map(r=>Array.isArray(r)?r.length:0));
  return (rows||[]).map(r=>{
    const line=Array.isArray(r)?r.slice():[];
    while(line.length<width)line.push('');
    return line.map(v=>String(v==null?'':v).trim());
  });
}
function countSeatNames(grid){
  const roster=new Set(seatClassStudents().map(s=>String(s.displayName||s.name||'')));
  return grid.flat().filter(c=>c&&roster.has(c)).length;
}
// 去掉首尾整行空白（Excel 常在数据后面留一串空行，会让“最后一行”判断落空）
function trimEmptyEdges(grid){
  const isEmptyRow=row=>!row||!row.some(c=>c);
  let first=0,last=grid.length-1;
  while(first<=last&&isEmptyRow(grid[first]))first++;
  while(last>=first&&isEmptyRow(grid[last]))last--;
  return first<=last?grid.slice(first,last+1):grid;
}
function analyzeSeatGrid(grid){
  grid=trimEmptyEdges(grid);
  const height=grid.length,width=height?grid[0].length:0;
  const roster=seatClassStudents();
  const byName=new Map();
  roster.forEach(s=>{byName.set(String(s.name||''),s);byName.set(String(s.displayName||''),s);});
  const notes=[];
  const note=(msg,kind)=>{notes.push({msg,kind});};
  // —— 第 1 步：判断表格方向：让“第 1 排”落在屏幕最下面（贴近讲台）
  // 判据 = 讲台位置标记在哪一行：组别名（第一组…）就代表讲台那一侧。
  //   讲台/组别名在【第一行】⇒ Excel 第一行是第 1 排 ⇒ 保持原方向；
  //   讲台/组别名在【最后一行】⇒ 最后一行才是第 1 排 ⇒ 需要上下镜像。
  // 修正一律只用【上下镜像】（行倒过来），绝不镜像列，否则左右会反。
  const podiumTop=podiumFromTop(grid,byName),podiumBottom=podiumFromBottom(grid,byName);
  const groupTop=groupLabelFromTop(grid),groupBottom=groupLabelFromBottom(grid);
  const option=seatImportView();
  let flipRows=(option==='flip');
  if(option==='auto')flipRows=!(podiumTop&&!podiumBottom);   // 只有“讲台标在第一行”时才保持原方向
  let sideL=null,sideR=null;
  if(flipRows){
    grid=grid.slice().reverse();   // 只上下镜像：行倒过来，列序保持（列不能再镜像，否则左右会反）
    const why=podiumBottom?'讲台/黑板标在表格最后一行（视为第 1 排）'
      :podiumTop?'讲台/黑板标在表格第一行'
      :(groupBottom?'表格没写讲台，但组别名在最后一行，按讲台同侧处理'
      :(groupTop?'表格没写讲台，但组别名在第一行':'没发现讲台/组别标记，按常见写法处理'));
    note('表格方向：'+why+'，因此把各排上下对调，让第 1 排落在屏幕最下方（贴近讲台）。若方向仍不对，在导入窗口切换“表格方向”重导即可','info');
  }else{
    note('表格方向：讲台/黑板标在表格第一行，Excel 第一行就是第 1 排，无需上下对调','info');
  }
  sideL=findSideSeat(grid,'sideL');sideR=findSideSeat(grid,'sideR');
  if(flipRows&&(sideL||sideR)){const t=sideL;sideL=sideR;sideR=t;}   // 上下对调后（等效于把纸立起来看），讲台左右也跟着换边
  // —— 第 2 步：逐列判断“是不是真正的座位列”（拿班内名单核对）
  const cols=Array.from({length:width},(_,c)=>{
    const values=grid.map(row=>row[c]);
    const named=values.filter(v=>v&&byName.has(v));
    return {
      index:c,
      names:named.length,
      empty:!values.some(Boolean),
      label:values.find(v=>v&&isSeatLabelCell(v))||'',
      sample:values.filter(Boolean).slice(0,3)
    };
  });
  // 名单命中 ≥SEAT_COL_MIN_NAMES 人 → 座位列；整列空白 → 大组之间的空列；其余 → 组别/方位标记列、或人不齐
  const kept=cols.filter(x=>x.names>=SEAT_COL_MIN_NAMES).map(x=>x.index);
  let dropped=cols.filter(x=>x.names<SEAT_COL_MIN_NAMES);
  // 保底：如果这么一砍就没剩几列，说明名单没对上（而不是表格有问题），宁可整表保留
  if(!kept.length||kept.length<Math.max(2,Math.ceil(width*0.3))){
    notes.push({msg:'有 '+dropped.length+' 列对不上班内名单，为避免误删已保留整张表（'+width+' 列）。请先确认这个班的名单已导入，或在导入窗口里改“表格方向”后重试',kind:'info'});
    return {flipRows,cols:width,rows:height,grid,sideL,sideR,matched:countSeatNames(grid),keptCols:width,dropped:[],notes};
  }
  const empties=dropped.filter(x=>x.empty);
  if(empties.length)note('忽略 '+empties.length+' 个整列空白的列（大组之间的空列不再算作一整组）','empty');
  dropped.filter(x=>x.label).forEach(x=>{
    note('“'+x.label+'”这一列是组别/方位标记列，不作为座位'+(x.names?'，该列还有 '+x.names+' 个能对上班内名单的姓名，会回到“未安排”':''),'group');
  });
  dropped.filter(x=>!x.empty&&!x.label).forEach(x=>{
    note('忽略第 '+(x.index+1)+' 列：整列只有 '+x.names+' 人能对上班内名单，按“一组不足 '+SEAT_COL_MIN_NAMES+' 人”处理'+(x.sample.length?'（该列内容：'+x.sample.join('、')+'）':''),'sparse');
  });
  // 姓名落进了“不成组的列”（组间空列、分隔列、标记列）：不是简单丢弃，而是告诉老师这一行对不齐
  const strayNames=[];
  dropped.forEach(x=>{
    grid.forEach((row,r)=>{
      const v=row[x.index];
      if(v&&byName.has(v)&&!strayNames.some(s=>s.name===v&&s.row===r)){
        strayNames.push({name:v,row:r,col:x.index,empty:x.empty});
      }
    });
  });
  const droppedIndexes=dropped.map(x=>x.index);
  let finalGrid=grid.map(row=>kept.map(c=>row[c]));
  // 只作为“门/窗/组别”存在的边界行不算排：去掉首尾没有座位姓名的行
  const isSeatRow=row=>row.some(c=>c&&byName.has(c));
  let first=0,last=finalGrid.length-1;
  while(first<=last&&!isSeatRow(finalGrid[first]))first++;
  while(last>=first&&!isSeatRow(finalGrid[last]))last--;
  const trimmed=first<=last?finalGrid.slice(first,last+1):finalGrid;
  const matched=countSeatNames(trimmed)-strayNames.length;
  strayNames.forEach(s=>{
    note('“'+s.name+'”在原表第 '+(s.row+1)+' 行、第 '+(s.col+1)+' 列——这是'+(s.empty?'大组之间的分隔列':'一个不成组的列')+'，说明这一行与其他行对不齐（多半是多写或漏写了一格）。已保持空位，请导入后在“编辑座位”里把它放到正确位置','sparse');
  });
  note('识别结果：'+kept.length+' 列 × '+trimmed.length+' 排，与班内名单核对上 '+matched+' 人'+(strayNames.length?'（另有 '+strayNames.length+' 人位置对不齐，见上）':''),'info');
  return {flipRows,cols:kept.length,rows:trimmed.length,grid:trimmed,sideL,sideR,matched,keptCols:kept.length,dropped:droppedIndexes,strayNames,notes};
}
// 这一行是不是“组别名行”（第一组/第二组…）：排除讲台左右标签那种带姓名的写法
function isGroupLabelRow(row){
  if(!row||!row.length)return false;
  const cells=row.filter(Boolean);
  if(!cells.length)return false;
  return cells.some(c=>/组/.test(c)&&isSeatLabelCell(c));
}
// 组别名写在表格最上面一行 ⇒ 讲台也在上方 ⇒ 需要整表旋转
function groupLabelFromTop(grid){
  return isGroupLabelRow(grid[0]||[]);
}
// 组别名写在表格最下面一行 ⇒ 讲台也在下方 ⇒ 不需要旋转
function groupLabelFromBottom(grid){
  return isGroupLabelRow(grid[grid.length-1]||[]);
}
// 这一行是不是“讲台行”：含讲台/黑板，且整行没有学生姓名（讲台格常和组别名、门等同处一行，不能要求它独占一行）
function isPodiumRow(row,byName){
  if(!row||!row.some(c=>{const m=seatMarker(c);return m&&m.podium;}))return false;
  if(byName)return !row.some(c=>c&&byName.has(c));
  return row.filter(Boolean).length<=1;
}
// 讲台/黑板标在表格最上面一行 ⇒ Excel 第一行就是第 1 排，不需要上下对调
function podiumFromTop(grid,byName){return isPodiumRow(grid[0]||[],byName);}
// 讲台/黑板标在表格最下面一行 ⇒ 最后一行才是第 1 排，需要上下对调
function podiumFromBottom(grid,byName){return isPodiumRow(grid[grid.length-1]||[],byName);}
function findSideSeat(grid,which){
  for(const row of grid)for(const cell of row){
    const m=seatMarker(cell);
    if(m&&m.side===which){const n=stripSideLabel(cell);if(n)return n;}
  }
  return null;
}
// 把识别到的原始格整理成 {cols,rows,grid,sideL,sideR,info}
function normalizeSeatRows(rows,view){
  const padded=padSeatRows(rows);
  if(isSeatListFormat(padded))return normalizeSeatList(padded);
  const analyzed=analyzeSeatGrid(padded);
  const cols=Math.max(1,Math.min(12,analyzed.cols||1)),rowsCount=Math.max(1,Math.min(12,analyzed.rows||1));
  const grid=Array.from({length:rowsCount},(_,r)=>Array.from({length:cols},(_,c)=>(analyzed.grid[r]&&analyzed.grid[r][c])||''));
  return {cols,rows:rowsCount,grid,sideL:analyzed.sideL,sideR:analyzed.sideR,info:analyzed};
}
// 清单式（表头含 列/排/姓名）：Excel 第一行＝第1排，不做翻转
function normalizeSeatList(rows){
  const head=rows[0].map(v=>String(v));
  const idxOf=re=>head.findIndex(v=>re.test(v));
  const iCol=idxOf(/列/),iRow=idxOf(/排/),iName=idxOf(/姓名|学生/),iSeat=idxOf(/座位/);
  let maxCol=0,maxRow=0;const entries=[];
  rows.slice(1).forEach(r=>{
    const marker=seatMarker(r[iSeat]||r[iCol]);
    const name=String(r[iName]||'').trim();
    if(marker&&marker.side){entries.push({side:marker.side,name:name||stripSideLabel(r[iSeat]||r[iCol])});return;}
    const col=Number(String(r[iCol]||'').replace(/[^0-9]/g,'')),row=Number(String(r[iRow]||'').replace(/[^0-9]/g,''));
    if(!col||!row)return;
    maxCol=Math.max(maxCol,col);maxRow=Math.max(maxRow,row);
    entries.push({col,row,name});
  });
  const grid=Array.from({length:Math.max(1,maxRow)},()=>Array.from({length:Math.max(1,maxCol)},()=>''));
  entries.forEach(e=>{if(e.col&&e.row)grid[e.row-1][e.col-1]=e.name;});
  const sideL=entries.find(e=>e.side==='sideL'),sideR=entries.find(e=>e.side==='sideR');
  const info={flipRows:false,cols:Math.max(1,maxCol),rows:Math.max(1,maxRow),grid,sideL:null,sideR:null,matched:countSeatNames(grid),keptCols:Math.max(1,maxCol),dropped:[],notes:[]};
  info.notes.push({msg:'按清单式表格识别（列/排/姓名），共 '+entries.length+' 条','kind':'info'});
  return {cols:info.cols,rows:info.rows,grid,sideL:sideL?sideL.name:null,sideR:sideR?sideR.name:null,info};
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
  const beforeSaved=copyLayout(state.seatLayout);   // applySeatImport 会就地改写 state.seatLayout，先留底
  const {placed,unmatched}=applySeatImport(normalized);
  const importHint=seatEditor?'（在编辑弹窗里：点“×”→“确认修改”后才保存）':'';
  if(seatEditor){
    // 从编辑弹窗里导入：进草稿，等点“确认修改”才真正保存
    seatEditor.layout=copyLayout(state.seatLayout);
    if(JSON.stringify(seatEditor.layout)!==JSON.stringify(beforeSaved)){
      if(!seatEditor.history.length)recordSeatSnapshot(seatEditor.base);
      seatEditor.dirty=true;
    }
    seatEditor.selectedSeatId='';seatEditor.selectedPoolId='';
  }else{
    await saveSeatLayout(state.seatLayout);
  }
  $('#seatImportModal')?.remove();
  if(seatEditor)renderSeatEditor();
  renderRollcall();
  showSeatImportResult(normalized,{placed,unmatched,hint:importHint});
}
// 导入结果卡：把“识别成几列几排、哪些列被忽略、有没有旋转、谁没对上”讲清楚
function showSeatImportResult(normalized,result){
  $('#seatImportResult')?.remove();
  const info=normalized.info||{};
  const matched=info.matched!==undefined?info.matched:result.placed;
  const stats='识别为 '+normalized.cols+' 列 × '+normalized.rows+' 排，'+matched+' 人与班内名单对上（共安排 '+result.placed+' 个座位）';
  const notes=(info.notes||[]).map(n=>'<li class="seat-import-note '+esc(n.kind||'info')+'">'+esc(n.msg)+'</li>').join('');
  const unmatched=result.unmatched&&result.unmatched.length
    ?'<p class="hint"><strong>没对上班内名单的单元格：</strong>'+esc(result.unmatched.slice(0,12).join('、'))+(result.unmatched.length>12?' 等 '+result.unmatched.length+' 个':'')+'<br>这些单元格保持空位，可用“按名册填充”或手动落座补齐。</p>'
    :'<p class="hint">没有出现对不上名单的名字。</p>';
  const modal=document.createElement('div');
  modal.id='seatImportResult';modal.className='modal-backdrop';
  modal.innerHTML='<div class="modal-card seat-import-card" role="dialog" aria-modal="true">'
    +'<div class="modal-header"><h2>导入完成</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>'
    +'<p class="seat-import-stats">'+esc(stats)+'</p>'
    +(notes?'<ul class="seat-import-notes">'+notes+'</ul>':'')
    +unmatched
    +(result.hint?'<p class="hint">'+esc(result.hint)+'</p>':'')
    +'<div class="actions"><button class="primary" id="seatImportOk">知道了</button></div>'
    +'</div>';
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#seatImportOk').onclick=close;
  modal.onclick=e=>{if(e.target===modal)close();};
}
async function exportSeatXlsx(){
  const layout=seatEditor?seatEditor.layout:state.seatLayout;   // 编辑器开着就导出当前草稿
  if(!layout){toast('还没有座位表');return;}
  if(typeof JSZip==='undefined'){toast('导出组件尚未加载，请刷新页面重试');return;}
  const nameOf=seat=>{const stu=studentOfSeat(seat);return stu?stu.name:'';};
  const seatIn=id=>layout.seats.find(s=>s.id===id)||null;
  const grid=[];
  for(let row=1;row<=layout.rows;row++){
    const line=[];
    for(let col=1;col<=layout.cols;col++)line.push(nameOf(layout.seats.find(s=>s.kind==='normal'&&s.row===row&&s.col===col)||null));
    grid.push(line);
  }
  grid.reverse();   // 教师视角：第一排写在最后一行
  grid.push(['讲台左：'+nameOf(seatIn('sideL')),...Array.from({length:Math.max(0,layout.cols-2)},()=>''),'讲台右：'+nameOf(seatIn('sideR'))]);
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
  toast(seatEditor?'座位表已导出（当前编辑中的安排，教师视角：第一排在最下面）':'座位表已导出（教师视角：第一排在最下面）');
}
function openSeatImport(){
  $('#seatImportModal')?.remove();
  const modal=document.createElement('div');
  modal.id='seatImportModal';modal.className='modal-backdrop';
  const viewSel=seatImportView();
  modal.innerHTML=`<div class="modal-card seat-import-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>导入座位表</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="field"><label>表格方向</label>\
<select id="seatImportViewSel">\
<option value="auto" ${viewSel==='auto'?'selected':''}>自动识别（推荐）</option>\
<option value="normal" ${viewSel==='normal'?'selected':''}>不上下对调（Excel 第一行 = 第1排）</option>\
<option value="flip" ${viewSel==='flip'?'selected':''}>上下对调（Excel 最后一行 = 第1排）</option>\
</select></div>\
<div class="field"><label>选择文件（.xlsx / .csv / .txt）</label>\
<input id="seatImportFile" type="file" accept=".xlsx,.csv,.txt"></div>\
<div class="field"><label>或直接粘贴表格（每行一排，用 Tab/逗号分隔）</label>\
<textarea id="seatImportText" rows="6" placeholder="第一组&#9;&#9;第二组&#10;张三&#9;&#9;李四&#10;王五&#9;&#9;赵六"></textarea></div>\
<p class="hint"><strong>会自动识别：</strong>大组之间的空列不算座位（不再把空列当成一整组）；“第一组 / 讲台 / 门 / 过道”等标记不会当成姓名；一列里能对上班内名单的姓名少于 ${SEAT_COL_MIN_NAMES} 人时不作为座位列。识别到讲台在表格上方时，整表旋转 180°（讲台对齐下方，靠近讲台的学生依然靠近讲台）。</p>\
<p class="hint">姓名一律用已导入的本班名单核对，所以请先导入学生成绩/名单。另支持清单式表格（表头含 列 / 排 / 姓名）。</p>\
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
