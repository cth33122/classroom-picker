// 认人小游戏：从「文件」页 →「数据与设置」→「学生头像」标题旁的 ？ 长按（约 0.9 秒）进入。
// 两种玩法：看头像选名字（一张大头像 + 4 个名字）、看名字选头像（一个名字 + 4 张头像），也可以混合出题。
// 只出本机已存过头像的同学；本班有头像的人不够 4 位时，自动放宽到全校。

const AVATAR_QUIZ_ROUNDS=10;       // 一局最多几题
const AVATAR_QUIZ_CHOICES=4;       // 每题几个选项
const AVATAR_QUIZ_LONG_PRESS=900;  // 长按多久算触发（毫秒）
const AVATAR_QUIZ_BEST_KEY='avatarQuizBest';
let avatarQuiz=null;               // 当前这一局：{pool,mode,questions,index,correct,locked,timer}
let avatarQuizBest=null;           // 最好成绩：{best,total,at}
let avatarQuizPress=null;          // 正在按住的那个手势
let avatarQuizSuppressClick=false; // 长按触发后，吞掉随后那次 click（不然会再弹帮助）

function quizShuffle(list){
  const out=list.slice();
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=out[i];out[i]=out[j];out[j]=t;}
  return out;
}
function quizNameOf(s){return String((s&&(s.displayName||s.name))||'').trim();}
function quizClassNameOf(s){return normalizeClassName(s&&s.className);}
function quizStudentById(id){return (state.students||[]).find(s=>s&&s.id===id)||null;}

// 出题材料：有头像的人（答案 + 头像选项）、本班全体（名字选项优先从本班里挑）
function avatarQuizPool(){
  const cls=normalizeClassName(state.currentClass);
  const all=(state.students||[]).filter(s=>s&&s.id&&quizNameOf(s));
  const photo=all.filter(s=>photoRecord(s.id));
  const classPhoto=photo.filter(s=>quizClassNameOf(s)===cls);
  const classAll=all.filter(s=>quizClassNameOf(s)===cls);
  const answerPool=classPhoto.length>=AVATAR_QUIZ_CHOICES?classPhoto:photo;
  return {cls:cls,all:all,photo:photo,classPhoto:classPhoto,classAll:classAll,answerPool:answerPool};
}

// 名字选项：先本班，不够再全校；保证名字互不相同、也不和正确答案重名
function quizNameOptions(answer,pool){
  const used=new Set([answer.name]);
  const pick=[];
  const take=list=>{
    for(const s of quizShuffle(list)){
      if(pick.length>=AVATAR_QUIZ_CHOICES-1)return;
      if(s.id===answer.id)continue;
      const n=quizNameOf(s);
      if(!n||used.has(n))continue;
      used.add(n);
      pick.push({id:s.id,name:n});
    }
  };
  take(pool.classAll);
  take(pool.all);
  return pick;
}

// 头像选项：都从有头像的人里挑（本班优先），名字互不相同
function quizAvatarOptions(answer,pool){
  const used=new Set([answer.name]);
  const pick=[];
  const take=list=>{
    for(const s of quizShuffle(list)){
      if(pick.length>=AVATAR_QUIZ_CHOICES-1)return;
      if(s.id===answer.id)continue;
      const n=quizNameOf(s);
      if(!n||used.has(n))continue;
      used.add(n);
      pick.push({id:s.id,name:n});
    }
  };
  take(pool.classPhoto);
  take(pool.photo);
  return pick;
}

function quizRoundCount(pool){return Math.min(AVATAR_QUIZ_ROUNDS,pool.answerPool.length);}

function quizBuildQuestions(mode,pool){
  const base=pool.answerPool;
  const total=Math.min(AVATAR_QUIZ_ROUNDS,base.length);
  const answers=[];
  const used=new Set();
  let bag=quizShuffle(base);
  let guard=0;
  while(answers.length<total&&guard++<600){
    if(!bag.length)bag=quizShuffle(base);
    const s=bag.pop();
    const n=quizNameOf(s);
    if(!n||used.has(n))continue;   // 同名的同学只出一次，否则两个选项长得一样
    used.add(n);
    answers.push(s);
  }
  const questions=[];
  for(const s of answers){
    const answer={id:s.id,name:quizNameOf(s)};
    const kind=mode==='mixed'?(Math.random()<0.5?'face':'name'):mode;
    const options=kind==='face'?quizNameOptions(answer,pool):quizAvatarOptions(answer,pool);
    if(options.length<AVATAR_QUIZ_CHOICES-1)return [];   // 人太少，凑不齐选项
    questions.push({kind:kind,answer:answer,options:quizShuffle(options.concat([answer]))});
  }
  return questions;
}

function avatarQuizShell(){
  let page=document.getElementById('avatarQuizPage');
  if(page)return page;
  page=document.createElement('div');
  page.id='avatarQuizPage';
  page.className='quiz-page';
  page.innerHTML=`<div class="quiz-head">\
<button type="button" class="quiz-back" data-quiz-close aria-label="关闭">←</button>\
<h2>认人小游戏</h2>\
<div class="quiz-score" id="quizScore"></div>\
</div>\
<div class="quiz-body" id="quizBody"></div>`;
  document.body.appendChild(page);
  page.querySelectorAll('[data-quiz-close]').forEach(b=>{b.onclick=closeAvatarQuiz;});
  return page;
}

function closeAvatarQuiz(){
  if(avatarQuiz&&avatarQuiz.timer)clearTimeout(avatarQuiz.timer);
  const page=document.getElementById('avatarQuizPage');
  if(page)page.remove();
  avatarQuiz=null;
}

function openAvatarQuiz(){
  document.getElementById('panelHelpModal')?.remove();
  const pool=avatarQuizPool();
  const page=avatarQuizShell();
  page.querySelector('#quizBody').innerHTML=avatarQuizIntroHtml(pool);
  page.querySelector('#quizScore').textContent='';
  avatarQuiz={pool:pool,mode:'',questions:[],index:0,correct:0,locked:false,timer:null};
  page.querySelectorAll('[data-quiz-mode]').forEach(btn=>{btn.onclick=()=>quizStart(btn.dataset.quizMode);});
  page.querySelectorAll('[data-quiz-close]').forEach(b=>{b.onclick=closeAvatarQuiz;});
}

function avatarQuizIntroHtml(pool){
  const photos=pool.photo.length;
  if(photos<AVATAR_QUIZ_CHOICES){
    return `<div class="quiz-done">\
<p class="quiz-done-score">头像太少</p>\
<p class="quiz-best">本机只存了 ${photos} 张学生头像，至少要有 ${AVATAR_QUIZ_CHOICES} 张才能出题。</p>\
<p class="quiz-best">先到上面「学生头像」里导入头像包，或到“学生”页点开某位同学给他设置头像。</p>\
<div class="quiz-done-actions"><button type="button" class="secondary" data-quiz-close>知道了</button></div>\
</div>`;
  }
  const scope=pool.answerPool===pool.photo&&pool.classPhoto.length<AVATAR_QUIZ_CHOICES
    ? `本班有头像的同学不够 ${AVATAR_QUIZ_CHOICES} 位，这次全校 ${photos} 位有头像的同学一起出题`
    : `本班有头像的同学 ${pool.classPhoto.length} 位`;
  const best=avatarQuizBest?`<p class="quiz-best">最好成绩：${avatarQuizBest.best} / ${avatarQuizBest.total}</p>`:'';
  return `<div class="quiz-intro">\
<p class="quiz-lead">考察你能不能认出同学的头像。一局最多 ${AVATAR_QUIZ_ROUNDS} 题，每题 ${AVATAR_QUIZ_CHOICES} 个选项。</p>\
<p class="quiz-scope">${esc(scope)}</p>\
<button type="button" class="secondary quiz-mode" data-quiz-mode="face"><strong>看头像，选名字</strong><span>给一张大头像，从 4 个名字里挑</span></button>\
<button type="button" class="secondary quiz-mode" data-quiz-mode="name"><strong>看名字，选头像</strong><span>给一个名字，从 4 张头像里挑</span></button>\
<button type="button" class="secondary quiz-mode" data-quiz-mode="mixed"><strong>两种混合</strong><span>两种题随机出，更像考试</span></button>\
${best}\
</div>`;
}

function quizStart(mode){
  const pool=(avatarQuiz&&avatarQuiz.pool)||avatarQuizPool();
  const questions=quizBuildQuestions(mode,pool);
  if(!questions.length){
    toast('有头像的同学太少，凑不齐 '+AVATAR_QUIZ_CHOICES+' 个选项');
    return;
  }
  avatarQuiz={pool:pool,mode:mode,questions:questions,index:0,correct:0,locked:false,timer:null};
  quizRenderRound();
}

function bindQuizActions(){
  const page=document.getElementById('avatarQuizPage');
  if(!page)return;
  page.querySelectorAll('[data-quiz-option]').forEach(btn=>{
    btn.onclick=()=>quizAnswer(btn.dataset.quizOption);
  });
}

function quizRenderRound(){
  const q=avatarQuiz;
  const page=document.getElementById('avatarQuizPage');
  if(!q||!page)return;
  const cur=q.questions[q.index];
  const answer=quizStudentById(cur.answer.id)||{id:cur.answer.id,name:cur.answer.name};
  const prompt=cur.kind==='face'
    ? `<div class="quiz-prompt quiz-face">${avatarHtml(answer,{size:200})}</div>`
    : `<div class="quiz-prompt quiz-name">${esc(cur.answer.name)}</div>`;
  const options=cur.options.map(o=>{
    const stu=quizStudentById(o.id)||{id:o.id,name:o.name};
    return cur.kind==='face'
      ? `<button type="button" class="quiz-option is-name" data-quiz-option="${esc(o.id)}"><span>${esc(o.name)}</span></button>`
      : `<button type="button" class="quiz-option is-avatar" data-quiz-option="${esc(o.id)}">${avatarHtml(stu,{size:96})}</button>`;
  }).join('');
  page.querySelector('#quizBody').innerHTML=`<div class="quiz-stage">\
${prompt}\
<p class="quiz-tip">${cur.kind==='face'?'这是谁？':'这个头像是谁？'}</p>\
<div class="quiz-options">${options}</div>\
<p class="quiz-feedback" id="quizFeedback"></p>\
</div>`;
  page.querySelector('#quizScore').textContent=`第 ${q.index+1}/${q.questions.length} 题 · 答对 ${q.correct}`;
  q.locked=false;
  bindQuizActions();
}

function quizAnswer(id){
  const q=avatarQuiz;
  const page=document.getElementById('avatarQuizPage');
  if(!q||q.locked||!page)return;
  q.locked=true;
  const cur=q.questions[q.index];
  const ok=id===cur.answer.id;
  if(ok)q.correct++;
  page.querySelectorAll('[data-quiz-option]').forEach(btn=>{
    const mine=btn.dataset.quizOption;
    if(mine===cur.answer.id)btn.classList.add('is-correct');
    else if(mine===id)btn.classList.add('is-wrong');
    else btn.classList.add('is-muted');
    btn.disabled=true;
  });
  const fb=page.querySelector('#quizFeedback');
  if(fb){
    fb.textContent=ok?'答对了':'答错了，是 '+cur.answer.name;
    fb.classList.add(ok?'is-ok':'is-bad');
  }
  page.querySelector('#quizScore').textContent=`第 ${q.index+1}/${q.questions.length} 题 · 答对 ${q.correct}`;
  q.timer=setTimeout(()=>{
    q.timer=null;
    if(avatarQuiz!==q)return;
    q.index++;
    if(q.index>=q.questions.length)quizFinish();
    else quizRenderRound();
  },ok?850:1500);
}

function quizRemark(rate){
  if(rate>=1)return '全对，班上的人都认出来了。';
  if(rate>=0.8)return '认得很准，基本不会喊错名字了。';
  if(rate>=0.6)return '差不多了，再熟悉熟悉就更稳。';
  if(rate>=0.4)return '认出一半，多看看头像吧。';
  return '还很陌生，建议先到“学生头像”里过一遍。';
}

function quizFinish(){
  const q=avatarQuiz;
  const page=document.getElementById('avatarQuizPage');
  if(!q||!page)return;
  const total=q.questions.length;
  const rate=total?q.correct/total:0;
  const isBest=!avatarQuizBest||q.correct>avatarQuizBest.best;
  if(isBest){
    avatarQuizBest={best:q.correct,total:total,at:Date.now()};
    DB.put('meta',{id:AVATAR_QUIZ_BEST_KEY,value:avatarQuizBest}).catch(()=>{});
  }
  page.querySelector('#quizScore').textContent='';
  page.querySelector('#quizBody').innerHTML=`<div class="quiz-done">\
<p class="quiz-done-score">${q.correct} / ${total}</p>\
<p class="quiz-done-line">正确率 ${Math.round(rate*100)}%${isBest?' · 新纪录':''}</p>\
<p class="quiz-best">${esc(quizRemark(rate))}</p>\
<div class="quiz-done-actions">\
<button type="button" class="primary" data-quiz-again>再来一局</button>\
<button type="button" class="secondary" data-quiz-home>换个玩法</button>\
</div>\
</div>`;
  page.querySelector('[data-quiz-again]').onclick=()=>quizStart(q.mode);
  page.querySelector('[data-quiz-home]').onclick=openAvatarQuiz;
}

// ---------- 隐藏入口：「学生头像」面板的 ？ ----------
// 点一下 = 打开头像说明（延后 280ms 再开，好把“双击”认出来）；
// 双击 = 进游戏；长按约 0.9 秒 = 也进游戏。后两种都算隐藏入口。
let avatarQuizClicks=0;
let avatarQuizClickTimer=null;
function avatarQuizBindEntry(){
  const helpBtn=e=>e.target&&e.target.closest?e.target.closest('[data-panel-help="data.avatar"]'):null;
  document.addEventListener('pointerdown',e=>{
    avatarQuizSuppressClick=false;          // 新手势开始，上次没被消费的标记作废
    const btn=helpBtn(e);
    if(!btn)return;
    if(!btn.dataset.quizHold){
      btn.dataset.quizHold='1';
      btn.addEventListener('contextmenu',ev=>ev.preventDefault());
    }
    avatarQuizPress={timer:setTimeout(()=>{
      avatarQuizPress=null;
      avatarQuizSuppressClick=true;
      avatarQuizClicks=0;
      clearTimeout(avatarQuizClickTimer);
      avatarQuizClickTimer=null;
      openAvatarQuiz();
    },AVATAR_QUIZ_LONG_PRESS)};
  },true);
  const stop=()=>{if(avatarQuizPress){clearTimeout(avatarQuizPress.timer);avatarQuizPress=null;}};
  document.addEventListener('pointerup',stop,true);
  document.addEventListener('pointercancel',stop,true);
  document.addEventListener('pointerleave',stop,true);
  document.addEventListener('contextmenu',e=>{if(avatarQuizPress||avatarQuizSuppressClick)e.preventDefault();},true);
  // 帮助面板自己接管：单击延迟打开、双击直接进游戏、长按触发后吞掉那次 click
  document.addEventListener('click',e=>{
    if(!helpBtn(e))return;
    e.preventDefault();
    e.stopPropagation();
    if(avatarQuizSuppressClick){avatarQuizSuppressClick=false;return;}
    avatarQuizClicks++;
    clearTimeout(avatarQuizClickTimer);
    avatarQuizClickTimer=null;
    if(avatarQuizClicks>=2){                // 双击：进游戏，不弹帮助
      avatarQuizClicks=0;
      openAvatarQuiz();
      return;
    }
    avatarQuizClickTimer=setTimeout(()=>{
      avatarQuizClickTimer=null;
      avatarQuizClicks=0;
      if(!document.getElementById('avatarQuizPage'))openPanelHelp('data.avatar');
    },280);
  },true);
  // 读上次的最好成绩（meta 表里一条记录）
  DB.all('meta').then(rows=>{
    const hit=(rows||[]).find(r=>r&&r.id===AVATAR_QUIZ_BEST_KEY);
    const v=hit&&hit.value&&typeof hit.value==='object'?hit.value:null;
    if(v&&Number.isFinite(v.best))avatarQuizBest=v;
  }).catch(()=>{});
}

avatarQuizBindEntry();
