// 点名复盘：问题记录（评价 emoji + 问题内容）
// 约定：复盘数据与那次点名共用一条 history 记录（questionId = String(history.id)），
// 所以在任何地方按 id 就能读写，不需要额外的关联表或级联删除。
// 全部入口（点名统计的“详情”、点名记录/学生详情里的问题栏、点名结果卡的 ✎）都走同一个全屏弹窗。

const EVAL_EMOJI={good:'😊',bad:'😢'};
function evalLabel(value){return EVAL_EMOJI[value]||'';}
// 评价用 emoji 直接表达，不做成原生 input 以免各平台配色差异过大
function evalText(value){return evalLabel(value)||'—';}

// 这位同学的复盘记录状态：{all, latest, reviewed}
// all = 全部点名记录（新→旧）；latest = 最新一条；reviewed = 已评价或已写问题的条数
function studentReviewState(studentId){
  const all=state.history
    .filter(x=>String(x.studentId)===String(studentId)&&x.id!==undefined)
    .slice()
    .sort((a,b)=>{
      const ta=Date.parse(a.at)||0,tb=Date.parse(b.at)||0;
      if(tb!==ta)return tb-ta;
      return (Number(b.id)||0)-(Number(a.id)||0);
    });
  const reviewed=all.filter(hasReviewContent).length;
  return {all,latest:all[0]||null,reviewed};
}
function hasReviewContent(x){
  return Boolean(x&&(x.eval||String(x.question||'').trim()));
}
// 有哪些记录做过复盘（评价或问题）——给统计页做标记用
function questionRecordsOf(studentId){
  return studentReviewState(studentId).all.filter(hasReviewContent);
}
// 问题内容压成一行，供列表里显示
function questionSummary(text,limit=40){
  const flat=String(text||'').replace(/\s+/g,' ').trim();
  return flat.length>limit?flat.slice(0,limit)+'…':flat;
}
function historyRecordById(id){
  return state.history.find(x=>String(x.id)===String(id))||null;
}
// 弹窗列出的记录：全部点名记录（新→旧）
function questionRowsForModal(studentId){
  return studentReviewState(studentId).all.filter(x=>historyRecordById(x.id));
}
// 按点名时间归出的月份（新→旧），例如 ['2026-03','2026-02','2025-12']
function reviewMonthKey(at){
  const d=new Date(at);
  if(Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function reviewMonthOptions(rows){
  const keys=[];
  rows.forEach(r=>{const k=reviewMonthKey(r.at);if(k&&!keys.includes(k))keys.push(k);});
  return keys.sort().reverse();
}
function reviewMonthLabel(key){
  const m=String(key||'').match(/^(\d{4})-(\d{2})$/);
  return m?`${Number(m[2])}月`:'';
}
// 文本框高度按实际内容分配：空 → 1 行；有内容 → 行数（上限 12 行后内部滚动）
const QUESTION_LINE_PX=21,QUESTION_MAX_LINES=12;
function questionLineCount(text){
  const t=String(text||'');
  if(!t.trim())return 1;
  return Math.max(1,Math.min(QUESTION_MAX_LINES,t.split('\n').length));
}
function fitQuestionBox(box){
  if(!box)return;
  const n=questionLineCount(box.value);
  box.style.height=(n*QUESTION_LINE_PX+18)+'px';
}

// 写入一条复盘改动：只改字段，不新增 history 行
async function saveHistoryReview(record,patch){
  if(!record)return null;
  const target=historyRecordById(record.id)||record;
  if('eval' in patch)target.eval=patch.eval||null;
  if('question' in patch){
    const text=String(patch.question||'').trim();
    target.question=text;
    target.questionAt=text?new Date().toISOString():null;
  }
  target.updatedAt=new Date().toISOString();
  await DB.put('history',target);
  return target;
}
async function toggleHistoryEval(record,value,options){
  if(!record)return null;
  const next=String(record.eval||'')===String(value)?null:value;
  const saved=await saveHistoryReview(record,{eval:next});
  if(!(options&&options.silent))toast(next?(next==='good'?'已记为 😊 满意':'已记为 😢 不满意'):'已取消这条的评价');
  return saved;
}

// 唯一的“问题记录”全屏弹窗。
// opts.focusId：打开后滚动并聚焦到这一条（从点名记录/问题栏点进来时用）
// opts.onClose ：关闭后的回调（各入口用它刷新自己那一页）
function openStudentQuestions(studentId,opts){
  const options=opts||{};
  const stu=state.students.find(s=>s.id===studentId);
  if(!stu){toast('找不到该学生');return;}
  const shown=stu.displayName||stu.name;
  $('#studentQuestionsModal')?.remove();
  const modal=document.createElement('div');
  modal.id='studentQuestionsModal';modal.className='modal-backdrop questions-fullscreen';
  document.body.appendChild(modal);
  // 待保存的问题文本：重绘或关闭前必须先冲刷，否则防抖期间的内容会随 DOM 重建一起丢掉
  const pending=new Map();
  const flushPending=async()=>{
    for(const [box,st] of [...pending.entries()]){
      if(st.timer){clearTimeout(st.timer);st.timer=null;}
      pending.delete(box);
      const rec=historyRecordById(box.dataset.qtext);
      if(!rec)continue;
      const typed=String(box.value??'');
      if(String(rec.question||'')!==typed.trim())await saveHistoryReview(rec,{question:typed});
    }
  };
  const rows=questionRowsForModal(studentId);
  const monthKeys=reviewMonthOptions(rows);
  const filter={month:'',text:''};
  let focusPending=Boolean(options.focusId);

  const rowHtml=rec=>{
    const at=new Date(rec.at).toLocaleString();
    const question=String(rec.question||'').trim();
    return '<div class="question-row" data-qid="'+esc(String(rec.id))+'" data-month="'+esc(reviewMonthKey(rec.at))+'" data-search="'+esc(question)+'">'
      +'<div class="question-row-head">'
      +'<span class="eval-picker">'
      +'<button type="button" class="eval-btn'+(rec.eval==='good'?' is-on is-good':'')+'" data-qeval="good" data-qid="'+esc(String(rec.id))+'" title="😊 满意（再点取消）">😊</button>'
      +'<button type="button" class="eval-btn'+(rec.eval==='bad'?' is-on is-bad':'')+'" data-qeval="bad" data-qid="'+esc(String(rec.id))+'" title="😢 不满意（再点取消）">😢</button>'
      +'</span>'
      +'<span class="question-time">'+esc(at)+'</span>'
      +'<span class="badge question-diff">'+esc(['','简单','适中','困难'][rec.difficulty]||'—')+'</span>'
      +'<button type="button" class="question-del" data-qdel="'+esc(String(rec.id))+'" title="删除这条点名记录">删除</button>'
      +'</div>'
      +'<textarea class="question-text" rows="1" data-qtext="'+esc(String(rec.id))+'" placeholder="没有记录，点这里补写…">'+esc(question)+'</textarea>'
      +'</div>';
  };
  const filterHtml=monthKeys.length?'<div class="question-filter">\
<span class="filter-label">月份</span>\
<div class="month-strip">\
<button type="button" class="month-pill is-on" data-month-pick="">全部</button>\
'+monthKeys.map(k=>'<button type="button" class="month-pill" data-month-pick="'+esc(k)+'">'+esc(reviewMonthLabel(k))+'</button>').join('')+'\
</div>\
<input type="search" id="questionSearch" class="question-search" placeholder="搜索问题内容">\
</div>':'';
  const body=rows.length?rows.map(rowHtml).join('')
    :'<div class="empty">这位同学还没有点名记录<br><span class="hint">先在点名页点一次名，再回来记录评价与问题</span></div>';

  modal.innerHTML='<div class="modal-card questions-card" role="dialog" aria-modal="true">'
    +'<div class="modal-header">'
    +'<h2>问题记录 · '+esc(shown)+'</h2>'
    +'<button class="icon-button modal-close" aria-label="关闭">×</button>'
    +'</div>'
    +filterHtml
    +'<p class="hint" id="questionCount">共 '+rows.length+' 次点名</p>'
    +'<div class="question-list">'+body+'</div>'
    +'</div>';

  const rowEls=()=>$$('#studentQuestionsModal .question-row');
  const updateFilter=()=>{
    const all=rowEls();
    all.forEach(el=>{
      const okMonth=!filter.month||el.dataset.month===filter.month;
      const okText=!filter.text||String(el.dataset.search||'').indexOf(filter.text)>=0;
      el.hidden=!(okMonth&&okText);
    });
    const n=all.filter(el=>!el.hidden).length;
    const count=$('#questionCount');
    if(count)count.textContent=(filter.month||filter.text)
      ? '筛选后 '+n+' / 共 '+all.length+' 次点名'
      : '共 '+all.length+' 次点名';
  };
  const bind=()=>{
    modal.querySelector('.modal-close').onclick=close;
    // 月份筛选：切换高亮并过滤
    $$('#studentQuestionsModal [data-month-pick]').forEach(b=>b.onclick=()=>{
      filter.month=b.dataset.monthPick||'';
      $$('#studentQuestionsModal [data-month-pick]').forEach(x=>x.classList.toggle('is-on',x.dataset.monthPick===filter.month));
      updateFilter();
    });
    let searchTimer=null;
    const search=$('#questionSearch');
    if(search)search.addEventListener('input',()=>{
      if(searchTimer)clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>{searchTimer=null;filter.text=String(search.value||'').trim();updateFilter();},180);
    });
    // 评价：点了立刻写库，再点同档取消
    $$('#studentQuestionsModal [data-qeval]').forEach(b=>b.onclick=async()=>{
      const rec=historyRecordById(b.dataset.qid);
      if(!rec){toast('这条记录已不存在');return;}
      await flushPending();          // 先把正在输入的问题落库，避免丢字
      const saved=await toggleHistoryEval(rec,b.dataset.qeval);
      const on=saved&&String(saved.eval||'')===b.dataset.qeval;
      const wrap=b.closest('.eval-picker');
      if(wrap)$$('.eval-btn',wrap).forEach(x=>{
        const hit=on&&x.dataset.qeval===b.dataset.qeval;
        x.classList.toggle('is-on',hit);
        x.classList.toggle('is-good',hit&&x.dataset.qeval==='good');
        x.classList.toggle('is-bad',hit&&x.dataset.qeval==='bad');
      });
      refreshRollcallAfterReview();
    });
    // 问题内容：输入防抖自动保存 + 高度按内容分配
    $$('#studentQuestionsModal [data-qtext]').forEach(box=>{
      fitQuestionBox(box);
      box.addEventListener('input',()=>{
        fitQuestionBox(box);
        const st=pending.get(box)||{};
        if(st.timer)clearTimeout(st.timer);
        st.timer=setTimeout(async()=>{
          st.timer=null;
          pending.delete(box);
          const rec=historyRecordById(box.dataset.qtext);
          if(!rec)return;
          await saveHistoryReview(rec,{question:box.value});
          const row=box.closest('.question-row');
          if(row)row.dataset.search=String(box.value||'').trim();
        },600);
        pending.set(box,st);
      });
      box.addEventListener('blur',async()=>{
        const st=pending.get(box);
        if(st&&st.timer){clearTimeout(st.timer);st.timer=null;}
        pending.delete(box);
        const rec=historyRecordById(box.dataset.qtext);
        if(!rec)return;
        if(String(rec.question||'')!==String(box.value||'').trim())await saveHistoryReview(rec,{question:box.value});
      });
    });
    // 删除这条点名记录（连同它的评价与问题）
    $$('#studentQuestionsModal [data-qdel]').forEach(b=>b.onclick=async()=>{
      const rec=historyRecordById(b.dataset.qdel);
      if(!rec)return;
      if(!confirm('删除这条点名记录吗？\n'+new Date(rec.at).toLocaleString()+' · 这条的评价与问题记录会一起删除'))return;
      await DB.remove('history',rec.id);
      state.history=state.history.filter(x=>String(x.id)!==String(rec.id));
      toast('已删除该条点名记录');
      const row=b.closest('.question-row');
      if(row)row.remove();
      updateFilter();
      refreshRollcallAfterReview();
    });
  };
  const close=async()=>{
    await flushPending();          // 关窗前把还没落库的问题内容写完
    modal.remove();
    if(typeof options.onClose==='function')options.onClose();
  };
  modal.onclick=ev=>{if(ev.target===modal)close();};
  bind();
  updateFilter();
  // 从点名记录/问题栏点进来：滚动到那一条并把光标放进它的文本框
  const focusTarget=()=>{
    if(!focusPending||!options.focusId)return;
    focusPending=false;
    const row=modal.querySelector('.question-row[data-qid="'+String(options.focusId).replace(/"/g,'')+'"]');
    if(!row)return;
    row.classList.add('is-focus');
    setTimeout(()=>row.classList.remove('is-focus'),2400);
    const box=row.querySelector('.question-text');
    requestAnimationFrame(()=>{
      row.scrollIntoView({block:'center'});
      if(box){
        try{box.focus({preventScroll:true});}catch(err){try{box.focus();}catch(e2){}}
        const len=String(box.value||'').length;
        try{box.setSelectionRange(len,len);}catch(err){}
      }
    });
  };
  focusTarget();
  setTimeout(focusTarget,60);
}

// 复盘改动后的统一刷新。
// 注意：五个页面是一次性预渲染后一直挂在 DOM 里的，切标签不会重绘，
// 所以统计页必须无条件重绘，否则从点名页改完问题再切过去看到的还是旧内容。
function refreshRollcallAfterReview(){
  if(!state.currentClass)return;
  // 统计页：点名记录会显示问题栏与评价列，必须同步
  if(state.statsMode!=='counts')renderHistory();
  // 学生页：详情页里也有一份点名记录（含问题栏）；长列表按需渲染，这里不碰
  if(state.studentDetail)renderStudentDetail(state.studentDetail);
  // 点名页：只在它当前可见时重绘，避免打断正在进行的点名
  if(state.view==='rollcall')renderRollcall();
}
