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

function renderSettings(){
  const s=state.settings,historyOptions=HISTORY_RULE_OPTIONS;
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
<label>近期点名次数统计规则</label>\
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
<h2>危险操作</h2>\
<p class="hint danger-text">删除后将清空学生资料、考试成绩、点名历史、缺席标记和设置，且无法从本机恢复。请先导出备份。</p>\
<button class="danger" id="clearAllSettingsBtn">删除所有数据</button>\
</div>\
<p class="hint app-version">当前版本：${APP_VERSION}</p>`;
    
  $$('[data-setting],[data-diff]').forEach(el=>el.addEventListener('change',()=>applySettingEdit(el)));
  $('#toggleAdvanced').onclick=()=>{state.settingsAdvanced=!state.settingsAdvanced;renderSettings();};
  $('#resetSettings').onclick=async()=>{state.settings=mergeConfig();await DB.put({id:'main',...state.settings});renderSettings();refreshCandidatesAfterSettings();toast('已恢复默认参数');};$('#saveShortcuts').onclick=async()=>{state.settings.shortcutClasses=$('#shortcutClasses').value.split(/[,，\s]+/).map(v=>normalizeClassName(v)).filter((v,i,a)=>v&&a.indexOf(v)===i);await DB.put({id:'main',...state.settings});render();};$('#clearAllSettingsBtn').onclick=clearAll;
}
