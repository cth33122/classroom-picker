// 共享状态与通用工具：state/$/$$、考试与成绩的读取换算

const state={view:'rollcall',students:[],history:[],absences:[],exams:[],examResults:[],settings:{},candidates:[],selectedCandidate:null,currentClass:'',difficulty:3,source:'',pendingImport:null,studentSort:'score-desc',studentDetail:null,studentDetailFrom:'',studentListScroll:0,statsMode:'timeline',historyStudentId:'',studentCurrentExamId:'',studentPreviousExamId:''};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

// Current-exam selection always derives the immediately older exam.
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600);}

function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

function relativeCallTime(at){const stamp=Date.parse(at);if(!Number.isFinite(stamp))return '—';const today=new Date();today.setHours(0,0,0,0);const day=new Date(stamp);day.setHours(0,0,0,0);const days=Math.max(0,Math.round((today-day)/86400000));return days===0?'今天':`${days}天前`;}

// 本地日期键 YYYY-MM-DD（用于比较“是否同一天”）
function localDayKey(value){const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

// 该生今天是否已经被点过名（座位表下划线标识用）
function calledToday(studentId){if(!studentId)return false;const today=localDayKey(new Date());return state.history.some(h=>h.studentId===studentId&&localDayKey(h.at)===today);}

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ---------- 姓名注音（拼音） ----------
// 声调表：1 阴平 2 阳平 3 上声 4 去声
const PINYIN_TONES={a:['ā','á','ǎ','à'],o:['ō','ó','ǒ','ò'],e:['ē','é','ě','è'],i:['ī','í','ǐ','ì'],u:['ū','ú','ǔ','ù'],'ü':['ǖ','ǘ','ǚ','ǜ']};
const PINYIN_MARKED=/[āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ]/;
// 去掉声调、把 v 当 ü，只保留字母与 ü
function pinyinBase(value){
  return String(value??'').toLowerCase()
    .replace(/[āáǎà]/g,'a').replace(/[ōóǒò]/g,'o').replace(/[ēéěè]/g,'e')
    .replace(/[īíǐì]/g,'i').replace(/[ūúǔù]/g,'u').replace(/[ǖǘǚǜ]/g,'ü')
    .replace(/v/g,'ü').replace(/[^a-zü]/g,'');
}
// 读出当前声调（0=轻声/无）
function pinyinTone(value){
  const text=String(value??'');
  if(!PINYIN_MARKED.test(text))return 0;
  if(/[āōēīūǖ]/.test(text))return 1;
  if(/[áóéíúǘ]/.test(text))return 2;
  if(/[ǎǒěǐǔǚ]/.test(text))return 3;
  return 4;
}
// 给音节加声调标记：a>o>e 优先，其次 iu 标 u、ui 标 i，其余标最后一个元音
function pinyinWithTone(base,tone){
  const b=pinyinBase(base);
  const t=Number(tone);
  if(!b||!t||t<1||t>4)return b;
  let index=-1;
  if(b.includes('a'))index=b.indexOf('a');
  else if(b.includes('o'))index=b.indexOf('o');
  else if(b.includes('e'))index=b.indexOf('e');
  else if(b.includes('iu'))index=b.indexOf('iu')+1;
  else for(let i=b.length-1;i>=0;i--){if('iuü'.includes(b[i])){index=i;break;}}
  if(index<0)return b;
  const marks=PINYIN_TONES[b[index]];
  return marks?b.slice(0,index)+marks[t-1]+b.slice(index+1):b;
}
// 一个音节可以写成 "zhang" 或 "zhang1"，返回 {base, tone}
function parsePinyinInput(value){
  const text=String(value??'').trim();
  const digit=text.match(/[0-5]\s*$/);
  const base=pinyinBase(digit?text.slice(0,digit.index):text);
  const tone=digit?Number(digit[0])%5:0;
  return {base,tone};
}
function isHanChar(ch){return /[\u3400-\u9fff]/.test(ch);}
// 姓名 + 注音 → ruby 标记；无注音或前缀不匹配时退回纯文本
function nameHtml(student,text){
  const label=String(text??(student?.displayName||student?.name||''));
  const name=String(student?.name??'');
  const readings=Array.isArray(student?.pinyin)?student.pinyin:[];
  if(!name||!readings.length||!label.startsWith(name))return esc(label);
  let out='';
  for(let i=0;i<name.length;i++){
    const reading=String(readings[i]??'').trim();
    out+=reading?`<ruby>${esc(name[i])}<rt>${esc(reading)}</rt></ruby>`:esc(name[i]);
  }
  return out+esc(label.slice(name.length));
}

function classes(){return [...new Set(state.students.map(s=>normalizeClassName(s.className)).filter(c=>c&&c!=='未分班'))].sort();}
// 切换班级并记住选择，刷新后仍停留在该班级
function setCurrentClass(value){state.currentClass=normalizeClassName(value);state.seatClass='';state.seatLayout=null;DB.put('meta',{id:'currentClass',value:state.currentClass}).catch(()=>{});}

function orderedExams(){return [...state.exams].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.importedAt).localeCompare(String(a.importedAt)));}

function chronologicalExams(){return [...state.exams].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.importedAt).localeCompare(String(b.importedAt)));}

function studentKey(student){const name=String(student?.name??'').trim().replace(/\s+/g,'');const nums=String(student?.className??'').match(/\d+/g);const cls=nums?.length?nums[nums.length-1]:String(student?.className??'').trim();return `${name}|${cls}`;}

function examResult(exam,student){if(!exam||!student)return null;const key=studentKey(student);const match=state.examResults.find(r=>r.examId===exam.id&&(r.studentId===student.id||r.identityKey===key||studentKey(r.result)===key));return match?.result||null;}

function examScoreRate(exam,result){if(!exam||!result)return null;const score=Number(result.score);const total=Number(exam.totalScore)||100;return Number.isFinite(score)&&total>0?Math.max(0,Math.min(1,score/total)):null;}

function averageScoreRate(student){const count=Number(state.settings.basisExamCount)||3;const exams=orderedExams().slice(0,count);let weighted=0,totalWeight=0;for(const exam of exams){const result=examResult(exam,student);const rate=examScoreRate(exam,result);const weight=Math.max(0,Number(exam.weight??1));if(rate!==null&&weight>0){weighted+=rate*weight;totalWeight+=weight;}}return totalWeight?weighted/totalWeight:null;}

function averageRankMap(students){const ranked=students.map(s=>({id:s.id,rate:averageScoreRate(s)})).sort((a,b)=>{if(a.rate===null&&b.rate===null)return String(a.id).localeCompare(String(b.id));if(a.rate===null)return 1;if(b.rate===null)return -1;return b.rate-a.rate||String(a.id).localeCompare(String(b.id));});return new Map(ranked.map((x,i)=>[x.id,x.rate===null?null:i+1]));}

function rankNumber(value){if(value===null||value===undefined||String(value).trim()===''||String(value).trim()==='—')return null;const n=Number(String(value).replace(/[^0-9.-]/g,''));return Number.isFinite(n)&&n>0?n:null;}

function rankDelta(current,previous){const now=rankNumber(current),old=rankNumber(previous);if(now===null||old===null)return '';const delta=now-old;if(delta===0)return '<span class="rank-same">（持平）</span>';return delta>0?`<span class="rank-down">（↓${delta}）</span>`:`<span class="rank-up">（↑${Math.abs(delta)}）</span>`;}

function rankColor(rank,max){const ratio=max?Math.max(0,Math.min(1,(rank-1)/(max-1||1))):0;return ratio<.33?'#dcfce7':ratio<.66?'#fef3c7':'#fee2e2';}

function examOptions(selected,allowEmpty=false){return `${allowEmpty?'<option value="">不选择</option>':''}${orderedExams().map(e=>`<option value="${esc(e.id)}" ${e.id===selected?'selected':''}>${esc(e.name||e.date)}</option>`).join('')||(!allowEmpty?'<option value="">暂无考试</option>':'')}`;}

function previousExamIdFor(currentId){
  const exams=orderedExams(), index=exams.findIndex(e=>e.id===currentId);
  return index>=0 ? (exams[index+1]?.id||'') : (exams[1]?.id||'');
}
