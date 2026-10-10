// 点名复盘：问题记录（评价 emoji + 问题内容）
// 约定：复盘数据与那次点名共用一条 history 记录（questionId = String(history.id)），
// 所以在任何地方按 id 就能读写，不需要额外的关联表或级联删除。

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
// 弹窗列出的记录：全部点名记录（新→旧），已复盘的排前面，方便继续补录
function questionRowsForModal(studentId){
  const all=studentReviewState(studentId).all.filter(x=>historyRecordById(x.id));
  return all.slice().sort((a,b)=>{
    const ra=hasReviewContent(a)?1:0,rb=hasReviewContent(b)?1:0;
    if(rb!==ra)return rb-ra;
    const ta=Date.parse(a.at)||0,tb=Date.parse(b.at)||0;
    if(tb!==ta)return tb-ta;
    return (Number(b.id)||0)-(Number(a.id)||0);
  });
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
function openRecordQuestionEditor(recordId,from){
  const rec=historyRecordById(recordId);
  if(!rec){toast('这条点名记录已不存在');return;}
  const stu=state.students.find(s=>s.id===rec.studentId);
  const shown=stu?(stu.displayName||stu.name):rec.studentId;
  const when=new Date(rec.at).toLocaleString();
  $('#questionRecordModal')?.remove();
  const modal=document.createElement('div');
  modal.id='questionRecordModal';modal.className='modal-backdrop';
  modal.innerHTML='<div class="modal-card question-record-card" role="dialog" aria-modal="true">'
    +'<div class="modal-header"><h2>记录问题 · '+esc(shown)+'</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>'
    +'<p class="hint">'+esc(when)+' · '+esc(['','简单','适中','困难'][rec.difficulty]||'—')+'</p>'
    +'<div class="field">'
    +'<label>本次评价</label>'
    +'<div class="eval-picker">'
    +'<button type="button" class="eval-btn'+(rec.eval==='good'?' is-on is-good':'')+'" data-eval="good">😊 满意</button>'
    +'<button type="button" class="eval-btn'+(rec.eval==='bad'?' is-on is-bad':'')+'" data-eval="bad">😢 不满意</button>'
    +'</div>'
    +'<p class="hint">再点一次同一档即可取消评价</p>'
    +'</div>'
    +'<div class="field">'
    +'<label for="questionInput">问题内容</label>'
    +'<textarea id="questionInput" rows="4" placeholder="记录这次问的问题，例如：说说第 3 题为什么这样变形…"></textarea>'
    +'</div>'
    +'<div class="actions"><button class="primary" id="questionSave">保存并关闭</button></div>'
    +'</div>';
  document.body.appendChild(modal);
  const input=$('#questionInput');
  input.value=String(rec.question||'');
  let changed=false;
  const paint=()=>{
    $$('#questionRecordModal .eval-btn').forEach(b=>{
      const on=String(rec.eval||'')===b.dataset.eval;
      b.classList.toggle('is-on',on);
      b.classList.toggle('is-good',on&&b.dataset.eval==='good');
      b.classList.toggle('is-bad',on&&b.dataset.eval==='bad');
    });
  };
  const close=async(save)=>{
    if(save){
      await saveHistoryReview(rec,{question:input.value});
      changed=true;
    }
    modal.remove();
    if(typeof from==='function')from();
    // 关掉这一条之后统一刷新：统计页的问题栏/评价列、学生详情页都要同步
    if(changed)refreshRollcallAfterReview();
  };
  $$('#questionRecordModal .eval-btn').forEach(b=>b.onclick=async()=>{
    await toggleHistoryEval(rec,b.dataset.eval,{silent:true});
    paint();
    changed=true;
  });
  $('#questionSave').onclick=()=>close(true);
  modal.querySelector('.modal-close').onclick=()=>close(true);
  modal.onclick=ev=>{if(ev.target===modal)close(true);};
  paint();
  input.focus();
}

// 该生的全部问题记录（新→旧），可查看、编辑、取消评价、删除
function openStudentQuestions(studentId,opts){
  const options=opts||{};
  const stu=state.students.find(s=>s.id===studentId);
  if(!stu){toast('找不到该学生');return;}
  const shown=stu.displayName||stu.name;
  $('#studentQuestionsModal')?.remove();
  const modal=document.createElement('div');
  modal.id='studentQuestionsModal';modal.className='modal-backdrop';
  document.body.appendChild(modal);
  // 待保存的问题文本：重绘或关闭前必须先冲刷，否则防抖期间的内容会随 DOM 重建一起丢掉
  const pending=new Map();
  const flushPending=async()=>{
    for(const [ta,st] of [...pending.entries()]){
      if(st.timer){clearTimeout(st.timer);st.timer=null;}
      pending.delete(ta);
      const rec=historyRecordById(ta.dataset.qtext);
      if(!rec)continue;
      const typed=String(ta.value??'');
      if(String(rec.question||'')!==typed.trim())await saveHistoryReview(rec,{question:typed});
    }
  };
  const render=()=>{
    const rows=questionRowsForModal(studentId);
    const reviewedCount=rows.filter(hasReviewContent).length;
    const body=rows.length?rows.map(rec=>{
      const at=new Date(rec.at).toLocaleString();
      const reviewAt=rec.questionAt?new Date(rec.questionAt).toLocaleString():'';
      const question=String(rec.question||'').trim();
      const done=hasReviewContent(rec);
      return '<div class="question-row'+(done?'':' is-todo')+'" data-qid="'+esc(String(rec.id))+'">'
        +'<div class="question-row-head">'
        +'<span class="question-time">'+esc(at)+'</span>'
        +'<span class="badge question-diff">'+esc(['','简单','适中','困难'][rec.difficulty]||'—')+'</span>'
        +(done?'<span class="badge question-done">已复盘</span>':'<span class="badge question-todo">未复盘</span>')
        +'<span class="eval-picker">'
        +'<button type="button" class="eval-btn'+(rec.eval==='good'?' is-on is-good':'')+'" data-qeval="good" data-qid="'+esc(String(rec.id))+'" title="标记满意（再点取消）">😊</button>'
        +'<button type="button" class="eval-btn'+(rec.eval==='bad'?' is-on is-bad':'')+'" data-qeval="bad" data-qid="'+esc(String(rec.id))+'" title="标记不满意（再点取消）">😢</button>'
        +'</span>'
        +'<button type="button" class="question-del" data-qdel="'+esc(String(rec.id))+'" title="删除这条点名记录">删除</button>'
        +'</div>'
        +'<textarea class="question-text" rows="2" data-qtext="'+esc(String(rec.id))+'" placeholder="点击这里记录这次问的问题…">'+esc(question)+'</textarea>'
        +(reviewAt?'<p class="hint question-review-at">复盘于 '+esc(reviewAt)+'</p>':'')
        +'</div>';
    }).join(''):'<div class="empty">这位同学还没有点名记录<br><span class="hint">先在点名页点一次名，再回来记录评价与问题</span></div>';
    modal.innerHTML='<div class="modal-card student-questions-card" role="dialog" aria-modal="true">'
      +'<div class="modal-header">'
      +'<h2>问题记录 · '+esc(shown)+'</h2>'
      +'<button class="icon-button modal-close" aria-label="关闭">×</button>'
      +'</div>'
      +'<p class="hint">共 '+rows.length+' 次点名，其中 '+reviewedCount+' 次已复盘。已复盘的排在前面；点 emoji 记评价（再点取消），问题内容自动保存。</p>'
      +'<div class="question-list">'+body+'</div>'
      +'</div>';
    bind(rows);
  };
  const bind=(rows)=>{
    modal.querySelector('.modal-close').onclick=close;
    // 评价：点了立刻写库，再点同档取消
    $$('#studentQuestionsModal [data-qeval]').forEach(b=>b.onclick=async()=>{
      const rec=historyRecordById(b.dataset.qid);
      if(!rec){toast('这条记录已不存在');render();return;}
      await flushPending();          // 先把正在输入的问题落库，避免重绘丢字
      await toggleHistoryEval(rec,b.dataset.qeval);
      render();
      refreshRollcallAfterReview();
    });
    // 问题内容：输入防抖自动保存（pending 表在重绘/关闭前会被冲刷）
    $$('#studentQuestionsModal [data-qtext]').forEach(ta=>{
      ta.addEventListener('input',()=>{
        const st=pending.get(ta)||{};
        if(st.timer)clearTimeout(st.timer);
        st.timer=setTimeout(async()=>{
          st.timer=null;
          pending.delete(ta);
          const rec=historyRecordById(ta.dataset.qtext);
          if(!rec)return;
          await saveHistoryReview(rec,{question:ta.value});
        },600);
        pending.set(ta,st);
      });
      ta.addEventListener('blur',async()=>{
        const st=pending.get(ta);
        if(st&&st.timer){clearTimeout(st.timer);st.timer=null;}
        pending.delete(ta);
        const rec=historyRecordById(ta.dataset.qtext);
        if(!rec)return;
        if(String(rec.question||'')!==String(ta.value||'').trim())await saveHistoryReview(rec,{question:ta.value});
      });
    });
    // 删除这条点名记录（连同它的复盘数据）
    $$('#studentQuestionsModal [data-qdel]').forEach(b=>b.onclick=async()=>{
      const rec=historyRecordById(b.dataset.qdel);
      if(!rec)return;
      if(!confirm('删除这条点名记录吗？\n'+new Date(rec.at).toLocaleString()+' · 这条的评价与问题记录会一起删除'))return;
      await DB.remove('history',rec.id);
      state.history=state.history.filter(x=>String(x.id)!==String(rec.id));
      toast('已删除该条点名记录');
      render();
      refreshRollcallAfterReview();
      if(state.view==='history')renderHistory();
      if(state.studentDetail)renderStudentDetail(state.studentDetail);
    });
    if(options.focusId){
      const el=modal.querySelector('[data-qid="'+String(options.focusId).replace(/"/g,'')+'"]');
      if(el){
        el.classList.add('is-focus');
        requestAnimationFrame(()=>el.scrollIntoView({block:'center'}));
        setTimeout(()=>el.classList.remove('is-focus'),2400);
      }
    }
  };
  const close=async()=>{
    await flushPending();          // 关窗前把还没落库的问题内容写完
    modal.remove();
    if(typeof options.onClose==='function')options.onClose();
  };
  modal.onclick=ev=>{if(ev.target===modal)close();};
  render();
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
