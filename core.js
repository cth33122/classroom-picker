// 共享状态与通用工具：state/$/$$、考试与成绩的读取换算

const state={view:'rollcall',students:[],history:[],absences:[],exams:[],examResults:[],settings:{},candidates:[],selectedCandidate:null,currentClass:'',difficulty:3,source:'',pendingImport:null,studentSort:'score-desc',studentDetail:null,statsMode:'timeline',historyStudentId:'',studentCurrentExamId:'',studentPreviousExamId:''};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

// Current-exam selection always derives the immediately older exam.
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600);}

function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

function relativeCallTime(at){const stamp=Date.parse(at);if(!Number.isFinite(stamp))return '—';const today=new Date();today.setHours(0,0,0,0);const day=new Date(stamp);day.setHours(0,0,0,0);const days=Math.max(0,Math.round((today-day)/86400000));return days===0?'今天':`${days}天前`;}

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function classes(){return [...new Set(state.students.map(s=>normalizeClassName(s.className)).filter(c=>c&&c!=='未分班'))].sort();}

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
