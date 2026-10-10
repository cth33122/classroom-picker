// 每周六 19:00 的备份提醒
// 说明：这是纯前端 PWA，没有服务器推送能力，所以提醒在“到点且页面开着”或“你之后打开应用”时出现，
// 不会像系统日程那样在你没打开应用时把手机叫醒。想更稳可以再加一条手机日历的每周提醒。

const BACKUP_REMINDER_SEEN_KEY='classRollcall.backupReminderSeen';
let backupReminderTimer=null;

function localDayKeyOf(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
// 提醒窗口：周六 19:00 之后，或整个周日（周六没看到还能补上）
function backupReminderDue(now){
  const d=now||new Date(),day=d.getDay();
  if(day===6)return d.getHours()>=19;
  if(day===0)return true;
  return false;
}
function backupReminderEnabled(){return !(state.settings&&state.settings.backupReminder===false);}
function backupReminderSeenKey(){
  try{return localStorage.getItem(BACKUP_REMINDER_SEEN_KEY)||'';}catch(err){return '';}
}
function markBackupReminderSeen(){
  try{localStorage.setItem(BACKUP_REMINDER_SEEN_KEY,localDayKeyOf(new Date()));}catch(err){}
}
// 有数据才提醒，空库没必要备份
function hasBackupWorthyData(){
  return Boolean((state.students&&state.students.length)||(state.history&&state.history.length)||(state.exams&&state.exams.length));
}
// 点名页顶部的提醒条；没有提醒时把容器清空
function renderBackupReminder(){
  const host=$('#backupReminder');
  if(!host)return;
  const show=backupReminderEnabled()&&hasBackupWorthyData()&&backupReminderDue()&&backupReminderSeenKey()!==localDayKeyOf(new Date());
  if(!show){host.innerHTML='';return;}
  const notifOk=typeof Notification!=='undefined'&&Notification.permission==='granted';
  host.innerHTML='<div class="panel reminder-banner" role="status">\
<div class="reminder-text">\
<strong>该备份了</strong>\
<span>现在是周末，建议导出一次完整备份（学生、成绩、点名记录、座位表都在里面）。</span>\
<span class="hint">导出到手机后建议再转存到网盘或电脑，避免浏览器数据被清理后一起丢失。</span>\
</div>\
<div class="reminder-actions">\
<button type="button" class="primary reminder-go" id="reminderGoBtn">去备份</button>\
'+(notifOk?'':'<button type="button" class="secondary reminder-notify" id="reminderNotifyBtn">开启系统通知</button>')+'\
<button type="button" class="reminder-dismiss" id="reminderDismissBtn">本周不再提醒</button>\
</div>\
</div>';
  $('#reminderGoBtn').onclick=()=>{setActiveView('data',{reset:true});};
  const notifyBtn=$('#reminderNotifyBtn');
  if(notifyBtn)notifyBtn.onclick=requestBackupNotificationPermission;
  $('#reminderDismissBtn').onclick=()=>{markBackupReminderSeen();renderBackupReminder();};
}
// 系统通知是可选项：需要在用户点击时申请权限（浏览器要求）
async function requestBackupNotificationPermission(){
  if(typeof Notification==='undefined'){toast('这台设备/浏览器不支持系统通知');return;}
  try{
    const result=await Notification.requestPermission();
    if(result==='granted'){toast('已开启：应用开着时到点会发系统通知');markBackupReminderSeen();showBackupSystemNotice();}
    else toast('未开启系统通知，仍会在应用内看到提醒');
  }catch(err){toast('开启失败：'+(err&&err.message));}
  renderBackupReminder();
}
function showBackupSystemNotice(){
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
  const body='今天是周末，建议导出一次完整备份（学生、成绩、点名记录、座位表）。';
  try{
    if(navigator.serviceWorker&&navigator.serviceWorker.ready){
      navigator.serviceWorker.ready.then(reg=>reg.showNotification('课堂智能点名 · 该备份了',{body,tag:'backup-reminder'})).catch(()=>{
        try{new Notification('课堂智能点名 · 该备份了',{body});}catch(err){}
      });
      return;
    }
  }catch(err){}
  try{new Notification('课堂智能点名 · 该备份了',{body});}catch(err){}
}
// 应用开着跨过周六 19:00 时，到点就提醒（并记一次系统通知）
function checkBackupReminderNow(){
  if(!backupReminderEnabled()||!hasBackupWorthyData()||!backupReminderDue())return;
  if(backupReminderSeenKey()===localDayKeyOf(new Date()))return;
  showBackupSystemNotice();
  if(state.view==='rollcall')renderBackupReminder();
}
// 安排下一次检查：优先精确等到下一个周六 19:00，最长不超过 30 分钟一次
function scheduleBackupReminder(){
  if(backupReminderTimer){clearTimeout(backupReminderTimer);backupReminderTimer=null;}
  const now=new Date();
  let target=new Date(now.getFullYear(),now.getMonth(),now.getDate(),19,0,0,0);
  const daysUntilSat=(6-now.getDay()+7)%7;
  target.setDate(target.getDate()+daysUntilSat);
  if(target<=now)target.setDate(target.getDate()+7);
  const delay=Math.max(60000,Math.min(target-now,1800000));
  backupReminderTimer=setTimeout(()=>{checkBackupReminderNow();scheduleBackupReminder();},delay);
}
// 顺带把周计划标在设置页的说明里（如果那个占位元素存在）
function updateBackupReminderHint(){
  const el=$('#backupReminderHint');
  if(el)el.textContent=backupReminderEnabled()
    ?'每周六 19:00 起在点名页顶部提醒一次备份（需要打开应用才能看到）。'
    :'已关闭每周备份提醒。';
}
function initBackupReminder(){
  scheduleBackupReminder();
  updateBackupReminderHint();
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){checkBackupReminderNow();updateBackupReminderHint();}
  });
  // 跨天/长时间开着时，每小时兜一次
  setInterval(checkBackupReminderNow,3600000);
}
