// 点名页：候选取人、点名落库、缺席标记

// 候选卡头像：渲染后按“卡片真实宽度 + 列表可用高度”自动算能放多大，夹在 [下限, 上限] 之间。
// 只有点名页用这套：座位表展开时纵向紧张，1 人 / 多人用横排（头像在左）省高度；2 人用竖排大卡。
const CAND_AVATAR_MIN=38;              // 老师反馈过太小，任何情况下都不小于它
const CAND_AVATAR_MAX_TALL=104;        // 竖排大卡（头像在上）的上限
const CAND_AVATAR_MAX_ROW=96;          // 横排卡（头像在左）的上限
const CAND_AVATAR_TEXT_RESERVE=96;     // 横排时留给“姓名 + 班次/点名”的横向空间
const CAND_AVATAR_SIZE='var(--cand-avatar,38px)';   // 首帧先用下限，refitCandidateAvatars 随后写真实值



function recommend(){state.settings.currentDifficulty=state.difficulty;const currentExam=orderedExams()[0];const pool=state.students.filter(s=>s.className===state.currentClass).map(s=>({...s,...(examResult(currentExam,s)||{}),scoreRate:averageScoreRate(s)}));state.candidates=chooseCandidates(pool,state.history,state.absences,{...state.settings,currentDifficulty:state.difficulty});renderRollcall();}

async function selectStudent(id){const s=state.students.find(x=>x.id===id);if(!s)return;await DB.put({studentId:id,at:new Date().toISOString(),difficulty:state.difficulty,className:state.currentClass});state.selectedCandidate=id;await reload();state.selectedCandidate=id;state.candidates=[{student:state.students.find(x=>x.id===id),recentCount:recentHistoryEntries(state.history,id,state.settings).length}];renderRollcall();toast(`已点名：${s.name}`);}

async function markSelectedAbsent(){
  const id=state.selectedCandidate;
  if(!id)return;
  const latest=[...state.history].filter(x=>x.studentId===id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  if(latest?.id!==undefined){await DB.remove('history',latest.id);state.history=state.history.filter(x=>x.id!==latest.id);}
  const absenceId=`${id}-${localDate()}`;
  await DB.put('absences',{id:absenceId,studentId:id,date:localDate()});
  state.absences=state.absences.filter(x=>!(x.studentId===id&&x.date===localDate()));
  state.absences.push({id:absenceId,studentId:id,date:localDate()});
  state.selectedCandidate=null;state.candidates=[];renderRollcall();toast('已撤销本次点名并标记今日缺席');
}

// 设置保存后：已经生成过候选、且尚未选中学生时，立即按新参数重抽一次
function refreshCandidatesAfterSettings(){
  if(state.selectedCandidate||!state.candidates.length)return;
  recommend();
}

// 候选卡排版：2 人竖排大卡（上头像下姓名）；1 人在座位表展开时用横排（省纵向高度）；
// 座位表收起/未安排座位时 1 人做成竖排单人卡；3 人以上横排紧凑。
function candidateLayout(count,seatShown){
  if(count===1)return {cols:1,tall:!seatShown};
  if(count===2)return {cols:2,tall:true};
  return {cols:seatShown?(count%2===0?2:3):2,tall:false};
}
// 按“卡片真实宽度 + 候选列表能分到的高度”算头像能放多大，写回 --cand-avatar。
// 座位表展开时**先满足座位图完整显示**：把除候选列表以外（含座位图所需完整高度）的占用都扣掉，
// 剩下的才是候选列表的额度；额度不够就把头像一档档压小，但绝不低于 CAND_AVATAR_MIN。
// 用渲染后的真实尺寸量，所以换机、转屏、横竖屏都会自动跟着变；量不到就用 CSS 默认高度和下限 38px。
function refitCandidateAvatars(){
  const list=$('#view-rollcall .candidate-list');
  if(!list)return;
  const cards=list.querySelectorAll('.candidate');
  const listW=list.clientWidth;
  if(!listW||!cards.length)return;
  const cols=Math.max(1,Math.round(Number(list.style.getPropertyValue('--cand-cols'))||1));
  const rows=Math.max(1,Math.ceil(cards.length/cols));
  const gap=10,padV=Number(getComputedStyle(cards[0]).paddingTop.replace('px',''))||10;
  const tall=cards[0].classList.contains('candidate-tall');
  const minCardH=(tall?CAND_AVATAR_MIN+48:CAND_AVATAR_MIN)+padV*2;   // 用下限尺寸时一张卡至少要多高
  const body=document.querySelector('#view-rollcall .rollcall-body');
  const chart=document.querySelector('#view-rollcall .seat-chart');
  const chartPanel=chart?chart.closest('.seat-panel'):null;
  const panel=list.closest('.panel');
  let maxH=0;
  if(body&&body.clientHeight>=200&&chart&&chartPanel&&panel){
    // 座位表展开：统计“其它部分”占掉的高度——座位面板按“座位图完整显示”算，候选面板只算列表之外的部分
    let occupied=0;
    [...body.children].forEach(el=>{
      const cs=getComputedStyle(el);
      let h=el.offsetHeight;
      if(el===panel)h=Math.max(0,h-list.offsetHeight);
      if(el===chartPanel)h=Math.max(0,h-chart.clientHeight)+chart.scrollHeight;
      occupied+=h+(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
    });
    maxH=Math.max(rows*minCardH,body.clientHeight-occupied);   // 再挤也不让卡片低于“下限头像”所需高度
    list.style.maxHeight=Math.round(maxH)+'px';
  }else{
    list.style.removeProperty('max-height');   // 座位表没展开：交回 CSS（收起时 56vh、未安排座位时同样）
    maxH=parseFloat(getComputedStyle(list).maxHeight)||Math.round((window.innerHeight||640)*0.32);
  }
  const perCard=(maxH-gap*(rows-1))/rows;
  const cardW=(listW-gap*(cols-1))/cols;
  // 竖排：头像独占一行，只需扣掉卡片上下内边距和下面两行文字；横排：还要给右边文字留出宽度
  const byWidth=tall?cardW-padV*2:cardW-CAND_AVATAR_TEXT_RESERVE;
  const byHeight=tall?perCard-padV*2-48:perCard-padV*2;
  const size=Math.round(Math.max(CAND_AVATAR_MIN,Math.min(tall?CAND_AVATAR_MAX_TALL:CAND_AVATAR_MAX_ROW,byWidth,byHeight)));
  list.style.setProperty('--cand-avatar',size+'px');
}
// 转屏 / 窗口尺寸变化后重新算一次（列表不在时函数自己会返回）
window.addEventListener('resize',()=>{requestAnimationFrame(refitCandidateAvatars);});
window.addEventListener('orientationchange',()=>{setTimeout(refitCandidateAvatars,120);});

function renderRollcall(){
  // 当前班级的座位表尚未加载时，先异步取一次再重绘
  if(state.currentClass&&state.seatClass!==state.currentClass&&!state.seatLoading){
    state.seatLoading=true;
    loadSeatLayout().then(()=>{state.seatLoading=false;renderRollcall();}).catch(()=>{state.seatLoading=false;});
  }
  const inClass=state.students.filter(s=>s.className===state.currentClass),rankMap=averageRankMap(inClass);
  // 候选是生成时的快照，标签等实时状态一律回查当前学生数据；已标记“不参与点名”的从列表里去掉
  const liveOf=c=>state.students.find(x=>x.id===c.student.id)||c.student;
  const visible=state.candidates.filter(c=>c.student.id===state.selectedCandidate||!liveOf(c).noCall);
  const emptyText=state.candidates.length?(visible.length?'':'候选中的学生都已被标记为“不参与点名”。'):'选择难度后生成候选';
  // 座位表：无人入座时折叠成一条提示；有人入座时可以点“座位表”标题收起/展开，收起后候选头像自动放大
  const seatedCount=state.seatLayout?state.seatLayout.seats.filter(s=>s.studentId).length:0;
  const seatCollapsed=Boolean(state.seatCollapsed);
  const seatPanel=seatedCount>0?`<div class="panel seat-panel${seatCollapsed?' is-collapsed':''}">\
<div class="seat-panel-head">\
<h3 class="seat-panel-title" id="seatPanelToggle" title="${seatCollapsed?'点击展开座位表':'点击收起座位表'}">座位表 <span class="seat-caret" aria-hidden="true">${seatCollapsed?'▸':'▾'}</span></h3>\
<div class="seat-panel-actions">\
<select id="seatColorMode" class="seat-color-select" title="座位着色" aria-label="座位着色模式">\
<option value="none">不上色</option>\
<option value="abs">得分率（绝对）</option>\
<option value="pct">得分率（百分位）</option>\
</select>\
<button class="secondary seat-edit-btn" id="editSeatBtn">编辑座位</button>\
</div>\
</div>\
${seatCollapsed?'<p class="hint">座位表已收起，候选头像已放大；点上面的“座位表”即可展开。</p>':seatChartHtml(seatFitCtxFor('roll'))}\
</div>`:`<div class="panel seat-panel seat-panel-collapsed">\
<div class="seat-panel-head">\
<h3>座位表</h3>\
<div class="seat-panel-actions">\
<span class="hint">未安排座位，点“编辑座位”安排后自动启用</span>\
<button class="secondary seat-edit-btn" id="editSeatBtn">编辑座位</button>\
</div>\
</div>\
</div>`;
  // 座位表没有占屏幕（未安排座位，或已收起）时，候选项用大一号的头像
  const seatShown=seatedCount>0&&!seatCollapsed;
  // 已点名：只显示“点名结果卡”，它不再是可点按钮 —— 再点也不会重复写点名记录
  const resultCard=state.selectedCandidate?(function(){
    const live=state.students.find(x=>x.id===state.selectedCandidate);
    if(!live)return '';
    const avg=averageScoreRate(live),rank=rankMap.get(live.id);
    const pickedCand=state.candidates.find(c=>c.student.id===live.id);
    const rec=latestCallRecord(live.id);
    return `<div class="candidate-result" data-result-student="${esc(live.id)}">\
<div class="candidate-result-head">\
${avatarHtml(live,{size:56,cls:'avatar-picked'})}\
<div class="candidate-result-who">\
<strong>${nameHtml(live,live.displayName||live.name)}</strong>${studentTags(live)}\
</div>\
<span class="candidate-result-diff">${['','简单','适中','困难'][state.difficulty]||''}</span>\
</div>\
<div class="candidate-result-meta">\
<span>${avg===null?'—':`${(avg*100).toFixed(1)}%`} · 班次 ${rank??'—'}</span>\
${pickedCand?`<span>近期点名次数：${pickedCand.recentCount}</span>`:''}\
</div>\
<div class="candidate-result-eval">\
<span class="hint">本次评价</span>\
<button type="button" class="eval-btn${rec&&rec.eval==='good'?' is-on is-good':''}" data-rollcall-eval="good" title="😊 满意（再点一次取消）">😊</button>\
<button type="button" class="eval-btn${rec&&rec.eval==='bad'?' is-on is-bad':''}" data-rollcall-eval="bad" title="😢 不满意（再点一次取消）">😢</button>\
<button type="button" class="secondary question-record-btn" data-rollcall-question="${esc(live.id)}" title="记录这次问的问题">✎ 记录问题</button>\
${rec&&String(rec.question||'').trim()?`<button type="button" class="student-link question-latest" data-student-questions="${esc(live.id)}" title="查看该生的问题记录">已记问题：${esc(questionSummary(rec.question,18))}</button>`:''}\
</div>\
</div>`;
  })():'';
  const candidateArea=state.selectedCandidate?resultCard
    :(function(){
      const layout=candidateLayout(visible.length,seatShown);
      const cards=visible.map(c=>{
        const live=liveOf(c),rank=rankMap.get(live.id);
        const name=`${nameHtml(live,live.displayName||live.name)}${live.focus?' <span class="badge">关注</span>':''}`;
        const meta=`<small class="candidate-meta"><span>班次 ${rank??'—'}</span><span>点名 ${c.recentCount}</span></small>`;
        const cls='candidate'+(layout.tall?' candidate-tall':'')+(visible.length===1?' candidate-single':'');
        if(layout.tall)return `<button type="button" class="${cls}" data-student="${esc(live.id)}">\
${avatarHtml(live,{size:CAND_AVATAR_SIZE})}\
<strong>${name}</strong>\
${meta}\
</button>`;
        return `<button type="button" class="${cls}" data-student="${esc(live.id)}">\
${avatarHtml(live,{size:CAND_AVATAR_SIZE})}\
<span class="candidate-main">\
<strong>${name}</strong>\
${meta}\
</span>\
</button>`;
      }).join('');
      return `<div class="candidate-list${seatShown?'':' is-roomy'}" style="--cand-cols:${layout.cols}">${visible.length?cards:`<div class="empty">${emptyText}</div>`}</div>`;
    })();
  $('#view-rollcall').innerHTML=`<div class="rollcall-body">\
${seatPanel}\
${seatedCount>0?'':'<div class="rollcall-gap"></div>'}\
<div class="panel">\
<div class="candidate-panel-head">\
<h3>${state.selectedCandidate?'本次点名':'本次候选'}</h3>\
<button class="note-link" id="rulesBtn">点名规则介绍</button>\
</div>\
${candidateArea}${!state.selectedCandidate&&visible.length===0&&state.currentClass?`<p class="hint">${String(state.settings.sameDayRepeat)==='allow'?'当天已点名的学生也可以再次进入候选。':'当天已点名的学生不会再次进入候选。'}标记为“不参与点名”的学生不会进入候选。</p>`:''}${state.selectedCandidate?'<div class="selected-actions"><button class="danger change-student" id="markSelectedAbsent">缺席</button><button class="secondary change-student" id="undoCallBtn">撤销</button></div>':''}</div>\
</div>\
<div class="panel hero rollcall-actions">\
<div class="rollcall-actions-head">\
<div class="class-name">${inClass.length?`本班 ${inClass.length} 人`:'还没有学生资料'}</div>\
<div class="question">${state.selectedCandidate?'单击难度按钮继续点名':'选择难度后生成候选'}</div>\
</div>\
<div class="difficulty-buttons">\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===1?'active':''}" data-difficulty="1">简单</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===2?'active':''}" data-difficulty="2">适中</button>\
<button class="secondary difficulty-button ${!state.selectedCandidate&&state.difficulty===3?'active':''}" data-difficulty="3">困难</button>\
</div>\
</div>`;
  $('#rulesBtn').onclick=()=>openRollcallRules();
  // 点“座位表”标题收起/展开；收起后候选项会换成大头像，选择记在本机
  const seatToggle=$('#seatPanelToggle');
  if(seatToggle)seatToggle.onclick=()=>{
    state.seatCollapsed=!state.seatCollapsed;
    DB.put('meta',{id:'seatCollapsed',value:state.seatCollapsed}).catch(()=>{});
    renderRollcall();
  };
  $('#editSeatBtn').onclick=()=>openSeatEditor();
  $$('#view-rollcall [data-seat]').forEach(b=>b.onclick=()=>openStudentDetailFromSeat(b.dataset.seat));
  const seatColorSel=$('#seatColorMode');
  if(seatColorSel){
    seatColorSel.value=seatColorModeValue();
    seatColorSel.onchange=e=>{
      state.seatColorMode=seatColorModeValue(e.target.value);
      DB.put('meta',{id:'seatColorMode',value:state.seatColorMode}).catch(()=>{});   // 记住选择，刷新后保留
      renderRollcall();
    };
  }
  refitSeats();
  requestAnimationFrame(refitSeats);
  refitCandidateAvatars();
  requestAnimationFrame(refitCandidateAvatars);
  $$('[data-difficulty]').forEach(b=>b.onclick=()=>{state.difficulty=Number(b.dataset.difficulty);state.selectedCandidate=null;recommend();});
  $$('#view-rollcall [data-student]').forEach(b=>b.onclick=()=>selectStudent(b.dataset.student));
  $$('#view-rollcall [data-rollcall-eval]').forEach(b=>b.onclick=()=>tapRollcallEval(b.dataset.rollcallEval));
  const questionBtn=$('#view-rollcall [data-rollcall-question]');
  if(questionBtn)questionBtn.onclick=()=>{
    const rec=latestCallRecord(state.selectedCandidate);
    if(!rec){toast('先点名再记录问题');return;}
    openStudentQuestions(rec.studentId,{focusId:rec.id,onClose:()=>renderRollcall()});
  };
  const questionsLink=$('#view-rollcall [data-student-questions]');
  if(questionsLink)questionsLink.onclick=()=>openStudentQuestions(questionsLink.dataset.studentQuestions,{onClose:()=>renderRollcall()});
  $('#markSelectedAbsent')?.addEventListener('click',markSelectedAbsent);
  $('#undoCallBtn')?.addEventListener('click',undoSelectedCall);
  paintRollcallEval(state.selectedCandidate?latestCallRecord(state.selectedCandidate):null);
}

// 该生最近一次点名记录（评价与问题就存在这条记录上）
function latestCallRecord(studentId){
  if(!studentId)return null;
  return [...state.history].filter(x=>String(x.studentId)===String(studentId))
    .sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0))[0]||null;
}
// 直接更新“本轮评价”那块按钮的状态，不整体重绘（避免重置候选）
function paintRollcallEval(rec){
  const value=rec?String(rec.eval||''):'';
  $$('#view-rollcall [data-rollcall-eval]').forEach(b=>{
    const on=value===b.dataset.rollcallEval;
    b.classList.toggle('is-on',on);
    b.classList.toggle('is-good',on&&b.dataset.rollcallEval==='good');
    b.classList.toggle('is-bad',on&&b.dataset.rollcallEval==='bad');
  });
}
async function tapRollcallEval(value){
  const rec=latestCallRecord(state.selectedCandidate);
  if(!rec){toast('先点名再记录评价');return;}
  const saved=await toggleHistoryEval(rec,value);
  if(saved){
    const idx=state.history.findIndex(x=>String(x.id)===String(saved.id));
    if(idx>=0)state.history[idx]=saved;
  }
  paintRollcallEval(saved);
}

// 撤销本次点名：删除刚写入的点名记录，并重新生成候选（该次的评价与问题也随之删除）
async function undoSelectedCall(){
  const id=state.selectedCandidate;
  if(!id)return;
  const latest=[...state.history].filter(x=>x.studentId===id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  const hadReview=Boolean(latest&&(latest.eval||String(latest.question||'').trim()));
  if(latest?.id!==undefined){
    await DB.remove('history',latest.id);
    state.history=state.history.filter(x=>x.id!==latest.id);
  }
  state.selectedCandidate=null;
  state.candidates=[];
  recommend();
  toast(hadReview?'已撤销本次点名（该次的评价与问题记录一并删除）':'已撤销本次点名');
}

// 点名规则介绍弹窗
function openRollcallRules(){
  $('#rulesModal')?.remove();
  const allowRepeat=String(state.settings.sameDayRepeat)==='allow';
  const modal=document.createElement('div');
  modal.id='rulesModal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="modal-card rules-card" role="dialog" aria-modal="true">\
<div class="modal-header">\
<h2>点名规则介绍</h2>\
<button class="icon-button modal-close" aria-label="关闭">×</button>\
</div>\
<div class="rules-body">\
<p><strong>近期点名次数</strong>：统计该生${historyRuleWindow(state.settings.historyRule)}的点名条数，与设置页“近期点名次数统计规则”一致（当前：${historyRuleLabel(state.settings.historyRule)}）。</p>\
<p><strong>抽中权重</strong>：近期被点得越多，抽中权重越低；<strong>近期没有被点到的学生抽中权重会升高</strong>，因此更容易被抽到。特别关注的学生不受“越点越低”的衰减影响，除非手动取消关注。</p>\
<p><strong>当天重复点名</strong>：${allowRepeat?'允许 —— 当天已点过的学生仍可再次进入候选。':'不允许 —— 当天已点过的学生不再进入候选。'}</p>\
<p><strong>其他</strong>：标记为“不参与点名”的学生不会进入候选；成绩靠后的学生（范围见设置页）在近期零次点名时还会获得额外加权。</p>\
</div>\
<div class="actions">\
<button class="primary" id="rulesClose">知道了</button>\
</div>\
</div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#rulesClose').onclick=close;
  modal.onclick=ev=>{if(ev.target===modal)close();};
}
