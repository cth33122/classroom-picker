// 设置页：点名参数与快捷班级


// 参数编辑：合法即刻生效并提示；不合法则提示且不生效（保留原值继续用）
function settingFieldLabel(el){return el.closest('.field')?.querySelector('label')?.textContent?.trim()||el.dataset.setting||'参数';}
function settingFieldRange(el){return el.tagName!=='SELECT'&&el.min!==''&&el.max!==''?`需在 ${el.min} – ${el.max} 之间`:'请输入有效值';}
function settingFieldValue(el){
  if(el.tagName==='SELECT')return el.value;
  const raw=String(el.value).trim();
  if(raw==='')return null;
  const num=Number(raw);
  if(!Number.isFinite(num))return null;
  const min=el.min!==''?Number(el.min):null,max=el.max!==''?Number(el.max):null;
  if(min!==null&&num<min)return null;
  if(max!==null&&num>max)return null;
  return num;
}
async function applySettingEdit(el){
  const label=settingFieldLabel(el),value=settingFieldValue(el);
  if(value===null){toast(`${label} 未生效：${settingFieldRange(el)}`);return;}
  const next={...state.settings};
  if(el.dataset.setting)next[el.dataset.setting]=value;
  else if(el.dataset.diff)next.difficulty={...state.settings.difficulty,[el.dataset.diff]:{...state.settings.difficulty[el.dataset.diff],[el.dataset.key]:value}};
  state.settings=mergeConfig(next);
  try{ await DB.put({id:'main',...state.settings}); }
  catch(err){ toast(`已生效但未能保存到本机：${err.message}`); return; }
  refreshCandidatesAfterSettings();
  const shown = el.tagName==='SELECT' ? (el.options[el.selectedIndex]?.textContent?.trim() || value) : value;
  toast(`已生效：${label} = ${shown}`);
}

function renderSettings(){  const s=state.settings,historyOptions=HISTORY_RULE_OPTIONS;
  $('#view-settings').innerHTML=`<div class="panel">\
<h2>点名参数</h2>\
<p class="hint">改动立即生效并自动保存，无需再点保存。</p>\
<div class="grid three">\
<div class="field">\
<label>候选人数</label>\
<input data-setting="candidateCount" type="number" min="1" max="12" value="${s.candidateCount}">\
</div>\
<div class="field">\
<label>点名依据：最近考试场数</label>\
<input data-setting="basisExamCount" type="number" min="1" max="20" value="${s.basisExamCount||3}">\
</div>\
<div class="field">\
<label><span>近期点名次数统计规则</span><button type="button" class="field-help" id="historyRuleHelpBtn" aria-label="这个设置是什么意思">?</button></label>\
<select data-setting="historyRule">${historyOptions.map(([v,l])=>`<option value="${v}" ${s.historyRule===v?'selected':''}>${l}</option>`).join('')}</select>\
</div>\
<div class="field">\
<label>当天允许重复点名</label>\
<select data-setting="sameDayRepeat">\
<option value="block" ${s.sameDayRepeat!=='allow'?'selected':''}>不允许（当天已点过的学生不再出现）</option>\
<option value="allow" ${s.sameDayRepeat==='allow'?'selected':''}>允许（同一天可以再次被点到）</option>\
</select>\
</div>\
</div>\
<div class="actions">\
<button class="secondary" id="toggleAdvanced">${state.settingsAdvanced?'收起更多参数':'更多参数'}</button>\
</div>\
<div class="grid three" id="advancedSettings"${state.settingsAdvanced?'':' style="display:none"'}>\
<div class="field">\
<label>成绩靠后学生范围</label>\
<input data-setting="lowScorePercentile" type="number" min="0" max="1" step="0.05" value="${s.lowScorePercentile||0.6}">\
</div>\
<div class="field">\
<label>零次点名额外权重</label>\
<input data-setting="zeroRecentBoost" type="number" min="1" max="5" step="0.05" value="${s.zeroRecentBoost||1.5}">\
</div>${[['recentDecay','近期衰减强度',0.1,0.95,0.01],['recoveryPerCall','冷却恢复速度',0.02,0.5,0.01],['focusBoost','特别关注加权',1,3,0.05]].map(([k,l,min,max,step])=>`<div class="field">\
<label>${l}</label>\
<input data-setting="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${s[k]}">\
</div>`).join('')}</div>\
<div class="actions">\
<button class="secondary" id="resetSettings">恢复默认</button>\
</div>\
</div>\
<div class="panel">\
<h2>快捷班级</h2>\
<div class="shortcut-editor">\
<input id="shortcutClasses" value="${esc((s.shortcutClasses||[]).join(','))}" placeholder="01,02,10">\
<button class="primary" id="saveShortcuts">保存快捷班级</button>\
</div>\
</div>\
<div class="panel">\
<h2>数据重置</h2>\
<div class="reset-actions">\
<button class="secondary" id="forceUpdateBtn">强制更新</button>\
<button class="danger" id="clearAllSettingsBtn">删除所有数据</button>\
</div>\
</div>\
<p class="hint app-version">当前版本：${APP_VERSION}</p>`;
    
  $$('[data-setting],[data-diff]').forEach(el=>el.addEventListener('change',()=>applySettingEdit(el)));
  $('#toggleAdvanced').onclick=()=>{state.settingsAdvanced=!state.settingsAdvanced;renderSettings();};
  $('#historyRuleHelpBtn').onclick=()=>openHistoryRuleHelp();
  $('#resetSettings').onclick=async()=>{state.settings=mergeConfig();await DB.put({id:'main',...state.settings});renderSettings();refreshCandidatesAfterSettings();toast('已恢复默认参数');};$('#saveShortcuts').onclick=async()=>{state.settings.shortcutClasses=$('#shortcutClasses').value.split(/[,，\s]+/).map(v=>normalizeClassName(v)).filter((v,i,a)=>v&&a.indexOf(v)===i);await DB.put({id:'main',...state.settings});render();};$('#forceUpdateBtn').onclick=forceAppUpdate;$('#clearAllSettingsBtn').onclick=clearAll;
}

// “近期点名次数统计规则”的说明弹窗：讲清它统计什么、影响什么、怎么选
function openHistoryRuleHelp(){
  $('#historyRuleHelpModal')?.remove();
  const s=state.settings||{};
  const current=historyRuleLabel(s.historyRule);
  const windowText=historyRuleWindow(s.historyRule);
  const decay=Math.max(0,Math.min(0.999,Number(s.recentDecay)||0.58));
  const options=HISTORY_RULE_OPTIONS.map(([v,l])=>
    '<li'+(s.historyRule===v?' class="is-on"':'')+'><strong>'+esc(l)+'</strong><span>'+esc(historyRuleWindow(v))+'</span></li>'
  ).join('');
  const modal=document.createElement('div');
  modal.id='historyRuleHelpModal';modal.className='modal-backdrop';
  modal.innerHTML='<div class="modal-card rule-help-card" role="dialog" aria-modal="true">'
    +'<div class="modal-header"><h2>近期点名次数统计规则</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>'
    +'<p class="hint">当前选择：<strong>'+esc(current)+'</strong>（'+esc(windowText)+'）</p>'
    +'<div class="rule-help-body">'
    +'<p><strong>它统计什么</strong><br>统计每位学生在所选范围内被点名的条数。这个数字有两处用途：候选卡片上的“近期点名次数”，以及下面说的抽中权重。</p>'
    +'<p><strong>它影响什么</strong><br>近期被点得越多，抽中权重越低（“越点越低”）。算法按“离现在越近的越算重”逐条累加：第 1 条按 '+decay.toFixed(2)+' 计、第 2 条按 '+(decay*decay).toFixed(2)+' 计，以此类推，再折算为冷却系数——所以<b>范围越宽，累计的衰减越多，权重被压得越低</b>；权重最低不低于 0.2，不会降到零。</p>'
    +'<p><strong>它还牵动两件事</strong><br>一是“零次点名额外权重”：在这个范围内一次都没被点到的学生，会自动获得额外加权（更容易被抽到）；二是“成绩靠后学生范围”的加价只对<b>零次</b>的学生生效。范围改宽后，原本算“零次”的学生可能变成“有记录”，这两项加价会随之消失。</p>'
    +'<p><strong>特例</strong><br>被标记为“特别关注”的学生不吃这套冷却，走独立的关注加权；标记为“不参与点名”的学生始终不进候选。</p>'
    +'<p><strong>怎么选</strong><br>按“次”的规则（如近 30 次）适合班级人数稳定、想让每个人都有机会被轮到；按“时间”的规则（如近 1 月）适合节奏固定、想体现近期表现的场景；选“总计”则只做总量平衡，一个学期内被点多的学生会持续被压低。</p>'
    +'<p><strong>与统计页的差别</strong><br>统计页“点名记录”上方的“统计范围”是另一个筛选器，只影响那一页显示多少条记录；若两处不一致，候选卡片上的数字仍以这里的选择为准。</p>'
    +'<p><strong>可选项一览</strong></p>'
    +'<ul class="rule-help-list">'+options+'</ul>'
    +'</div>'
    +'<div class="actions"><button class="primary" id="historyRuleHelpOk">知道了</button></div>'
    +'</div>';
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('.modal-close').onclick=close;
  $('#historyRuleHelpOk').onclick=close;
  modal.onclick=ev=>{if(ev.target===modal)close();};
}
