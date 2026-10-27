// 设置页：点名参数与快捷班级

// 这一页各面板的说明：不再是页面上的小字，改成标题右边的“？”弹窗
registerPanelHelp('settings.params','点名参数',
  `<p>改动<strong>立即生效并自动保存</strong>，无需再点保存。</p>\
<p>“近期点名次数统计规则”这一项旁边也有个问号，点开是它自己的说明（统计什么、影响什么、怎么选）。</p>\
<p>点“更多参数”可以看到衰减、恢复、关注加权等进阶数值，改坏了可以“恢复默认”。</p>`);
registerPanelHelp('settings.identity','数据身份',
  `<p><strong>身份编号（uid）</strong>：每位学生都有一个软件内置、永不变的编号，点名历史、评价、问题、头像、成绩都挂在它上面。所以以后分班、改班级名、改姓名，这些数据都会跟着学生走，不会丢。</p>\
<p>面板里那一行小字就是当前状态（只读）。</p>\
<p><strong>备选认人编号是什么</strong>：每次导入成绩表，表里的“学号/考号/准考证号/自定义考号…”这些列都会顺手记在对应学生名下，<strong>只在同名需要区分时用来辅助判断</strong>，不是身份编号，也不会影响成绩和点名历史。</p>\
<p><strong>“N 条记录”</strong>是记录条数、不是人数：一个学生的一个列算一条。比如 955 个学生、表里有“准考证号”和“自定义考号”两列，就是 1910 条记录。</p>\
<p><strong>“含列名 …”</strong>是归到这一族的原始列名。学校不同表里列名不一样（准考证号 / 自定义考号 / 考生号 / 考号 其实是同一类编号），所以按“族”归堆统计和清除。</p>\
<p><strong>列表只显示当前班级</strong>（就是点名页/学生页选的那个班），避免一屏几百人；但上面「清除全校…」的按钮<strong>作用于全校</strong>——因为一列编号靠不靠谱是这份文件/这一列的性质，跟哪个班无关。</p>\
<p><strong>怎么用</strong>：清除分两级粒度，都作用于全校——</p>\
<p>· <strong>只清某一列</strong>：例如只有“准考证号”不可靠、而“自定义考号”很准，就点「只清「准考证号」」，同族其它列名原样保留；</p>\
<p>· <strong>整族清</strong>：整族都不可靠（例如换了一批随机考号）时点「整个「考号」族」，准考证号/自定义考号/考生号 一起清掉；</p>\
<p>· 只是某个学生的某一条编号记错了、或两个学生共用了同一个编号（会造成同名判定歧义）→ 点那个编号后面的 ×，只删那一条。</p>`);


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

// “备选编号”面板：列出导入时顺带记下的学号/考号（只在同名时辅助认人，不代表身份）
// 统计与清除都按全校算；**学生明细只列当前班级**，否则几百人一屏没法看。
let aliasFoldOpen=false;      // 折叠块的展开状态（重绘后保持，否则删一条就自动收起来）
let aliasListScroll=0;        // 明细列表的滚动位置（重绘后还原）

// 整族清除按钮：作用于全校，放在折叠块外面始终可见（它管的是“这一列靠不靠谱”，不是某个学生）
// 清除有两级粒度：按**列名**单独清（如只清“准考证号”），或按**族**整族清（考号族 = 准考证号/自定义考号/考生号…）
function aliasClearActionsHtml(){
  const withIds=(state.students||[]).filter(s=>s&&Array.isArray(s.ids)&&s.ids.some(x=>x&&x.value));
  if(!withIds.length)return '';
  const families=new Map();     // family -> {n, types: Map(列名 -> 条数)}
  withIds.forEach(s=>s.ids.forEach(x=>{
    if(!x||!x.value)return;
    const family=idFamilyOfAlias(x)||'其他编号';
    const type=String(x.type||'（未标注列名）');
    const rec=families.get(family)||{n:0,types:new Map()};
    rec.n++;rec.types.set(type,(rec.types.get(type)||0)+1);
    families.set(family,rec);
  }));
  const rows=[...families.entries()].sort((a,b)=>b[1].n-a[1].n).map(([family,rec])=>{
    const typeBtns=[...rec.types.entries()].sort((a,b)=>b[1]-a[1]).map(([type,n])=>
      `<button type="button" class="secondary alias-clear-btn" data-clear-alias-type="${esc(type)}" title="只清除全校学生「${esc(type)}」这一列记下的编号（共 ${n} 条），同族其它列名不受影响">只清「${esc(type)}」<span class="alias-clear-count">${n} 条</span></button>`).join('');
    // 只有一族里不止一个列名时，“整族清”才和“只清某一列”有区别，否则按钮就重复了
    const familyBtn=rec.types.size>1
      ?`<button type="button" class="secondary alias-clear-btn" data-clear-alias-family="${esc(family)}" title="清除「${esc(family)}」这一族全部列名记下的编号（共 ${rec.n} 条）">整个「${esc(family)}」族<span class="alias-clear-count">${rec.n} 条</span></button>`
      :'';
    return `<div class="alias-family-row"><span class="alias-family-name">${esc(family)}</span><span class="alias-family-btns">${typeBtns}${familyBtn}</span></div>`;
  }).join('');
  return `<div class="alias-clear-block">${rows}</div>`;
}

// 清除前的确认弹窗：写清作用范围（全校），并**罗列本班的编号示例**，免得点一下就把东西清掉
function aliasClearMatcher(kind,key){
  const isFamily=kind==='family';
  return entry=>{
    if(!entry||!entry.value)return false;
    if(isFamily)return (idFamilyOfAlias(entry)||'其他编号')===key;
    return String(entry.type||'（未标注列名）')===key;
  };
}
function openAliasClearDialog(kind,key){
  return new Promise(resolve=>{
    document.getElementById('aliasClearModal')?.remove();
    const isFamily=kind==='family';
    const match=aliasClearMatcher(kind,key);
    const rawCls=String(state.currentClass||'').trim();
    const cls=rawCls?normalizeClassName(rawCls):'';
    let totalN=0;const totalWho=new Set();
    let clsN=0;const clsRows=[],allRows=[];
    (state.students||[]).forEach(s=>{
      if(!s||!Array.isArray(s.ids))return;
      const hits=s.ids.filter(match);
      if(!hits.length)return;
      totalN+=hits.length;totalWho.add(s.id);
      allRows.push({s,hits});
      if(cls&&s.className===cls){clsN+=hits.length;clsRows.push({s,hits});}
    });
    const shown=cls?clsRows:allRows;
    const examples=shown.slice(0,8).map(({s,hits})=>{
      const vals=hits.slice(0,3).map(x=>isFamily
        ?`${esc(String(x.value))}<span class="hint">（${esc(String(x.type||'编号'))}）</span>`
        :esc(String(x.value))).join('、')+(hits.length>3?' 等':'');
      return `<li><span class="alias-clear-who">${esc(s.displayName||s.name)}</span><span class="alias-clear-vals">${vals}</span></li>`;
    }).join('');
    const scopeText=cls
      ?`全校共 <strong>${totalN}</strong> 条记录、涉及 <strong>${totalWho.size}</strong> 人；其中本班（${esc(cls)}）<strong>${clsN}</strong> 条、${clsRows.length} 人。`
      :`全校共 <strong>${totalN}</strong> 条记录、涉及 <strong>${totalWho.size}</strong> 人。`;
    const title=isFamily?`清除「${esc(key)}」这一族的备选编号`:`清除「${esc(key)}」这一列的备选编号`;
    const modal=document.createElement('div');
    modal.id='aliasClearModal';modal.className='modal-backdrop';
    modal.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true">\
<div class="modal-header"><h2>${title}</h2><button class="icon-button modal-close" aria-label="关闭">×</button></div>\
<div class="rule-help-body">\
<p>${scopeText}</p>\
<p class="hint">下面是${cls?'本班':'全校'}的编号示例（清除后这些编号不再参与“同名时辅助认人”）：</p>\
${examples?`<ul class="alias-clear-list">${examples}</ul>${shown.length>8?`<p class="hint">…以及另外 ${shown.length-8} 人</p>`:''}`:'<div class="empty">没有要清除的编号</div>'}\
<p class="hint">清除只影响同名判定的依据，<strong>不影响成绩、点名历史与身份编号</strong>。</p>\
</div>\
<div class="actions">\
<button type="button" class="secondary" id="aliasClearCancel">取消</button>\
<button type="button" class="danger" id="aliasClearOk">确认清除</button>\
</div>\
</div>`;
    document.body.appendChild(modal);
    const close=v=>{modal.remove();resolve(v);};
    modal.querySelector('.modal-close').onclick=()=>close(false);
    modal.onclick=e=>{if(e.target===modal)close(false);};
    $('#aliasClearCancel').onclick=()=>close(false);
    $('#aliasClearOk').onclick=()=>close(true);
  });
}

function aliasPanelHtml(){
  // 注意 normalizeClassName('') 会返回“未分班”，所以没选班级时要先判断空值（否则列表会变成空）
  const rawCls=String(state.currentClass||'').trim();
  const cls=rawCls?normalizeClassName(rawCls):'';
  const withIds=(state.students||[]).filter(s=>s&&Array.isArray(s.ids)&&s.ids.some(x=>x&&x.value));
  if(!withIds.length)return '<p class="hint">还没有记录任何备选编号（导入带学号/考号的成绩表后会自动记下）。</p>';
  const rows=(cls?withIds.filter(s=>s.className===cls):withIds)
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN'));
  const scope=cls?`本班（${cls}）${rows.length} 人有记录`:`全校 ${rows.length} 人有记录`;
  const list=rows.slice(0,400).map(s=>{
    // 注意：不能用 \u0000 之类的字符当属性分隔符——HTML 解析会把 NULL 换成 U+FFFD，取回来就分不开了
    const chips=s.ids.filter(x=>x&&x.value).map(x=>
      `<span class="alias-chip" title="${esc(String(x.type||idFamilyOfAlias(x)||'编号'))}">${esc(String(x.value))}<button type="button" class="alias-del" data-del-alias-student="${esc(s.id)}" data-del-alias-value="${esc(String(x.value))}" title="只删这一条编号（用于单个编号记错/两个学生共用同一编号的纠错）" aria-label="删除这条编号">×</button></span>`).join('');
    return `<div class="alias-row"><span class="alias-who">${esc(s.displayName||s.name)}${cls?'':`<span class="hint">（${esc(s.className||'—')}）</span>`}</span><span class="alias-chips">${chips}</span></div>`;
  }).join('');
  return `<details class="identity-fold alias-fold"${aliasFoldOpen?' open':''}>\
<summary>备选认人编号 <span class="hint">${esc(scope)}</span></summary>\
<div class="identity-body">\
${aliasClearActionsHtml()}\
<div class="alias-list">${list||'<div class="empty">本班还没有记录到编号</div>'}${rows.length>400?'<p class="hint">（只显示前 400 人）</p>':''}</div>\
</div>\
</details>`;
}

function renderSettings(){  const s=state.settings,historyOptions=HISTORY_RULE_OPTIONS;
  $('#view-settings').innerHTML=`<div class="panel">\
<h2 class="with-help">点名参数 ${panelHelpBtn('settings.params','点名参数的说明')}</h2>\
<div class="grid three">\
<div class="field">\
<label>候选人数</label>\
<select data-setting="candidateCount">${CANDIDATE_CHOICES.map(n=>`<option value="${n}" ${Number(s.candidateCount)===n?'selected':''}>${n} 人</option>`).join('')}</select>\
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
<h2 class="with-help">成绩分析 ${panelHelpBtn('grade.analysis','成绩分析判定规则的说明')}</h2>\
<div class="grid three">\
<div class="field">\
<label>看最近几场（场）</label>\
<input data-setting="gradeWindow" type="number" min="3" max="5" step="1" value="${s.gradeWindow||GRADE_STATUS_DEFAULTS.window}">\
</div>\
<div class="field">\
<label>走低：平均每场变化</label>\
<input data-setting="gradeStep" type="number" min="0.01" max="0.40" step="0.01" value="${s.gradeStep||GRADE_STATUS_DEFAULTS.step}">\
</div>\
<div class="field">\
<label>陡降/陡升：最近一步变化</label>\
<input data-setting="gradeJump" type="number" min="0.02" max="0.60" step="0.01" value="${s.gradeJump||GRADE_STATUS_DEFAULTS.jump}">\
</div>\
<div class="field">\
<label>持续偏低/持续高分：分界百分之…</label>\
<input data-setting="gradeLowPct" type="number" min="0.5" max="0.95" step="0.05" value="${s.gradeLowPct||GRADE_STATUS_DEFAULTS.lowPct}">\
</div>\
</div>\
<p class="hint">都用“段排位百分位”（段排名÷当场段人数，0 最好、1 最差），数值越小越敏感。只看最近几场、不取中位数，中间有反弹也能判出来。「分界百分之」同时决定两头：后 20%＝持续偏低（单独成组放最上面），前 20%＝持续高分。改完到“学生”页点“成绩分析”即可看到结果。</p>\
</div>\
<div class="panel">\
<h2 class="with-help">班级分析 ${panelHelpBtn('class.analysis','班级分析的说明')}</h2>\
<div class="grid three">\
<div class="field">\
<label>段前百分比（%）</label>\
<input data-setting="classTopPct" type="number" min="2" max="50" step="1" value="${s.classTopPct||CLASS_ANALYSIS_DEFAULTS.topPct}">\
</div>\
<div class="field">\
<label>段后百分比（%）</label>\
<input data-setting="classBottomPct" type="number" min="2" max="50" step="1" value="${s.classBottomPct||CLASS_ANALYSIS_DEFAULTS.bottomPct}">\
</div>\
</div>\
<p class="hint">段次落在前 ${s.classTopPct||CLASS_ANALYSIS_DEFAULTS.topPct}% 的算“段前”，落在后 ${s.classBottomPct||CLASS_ANALYSIS_DEFAULTS.bottomPct}% 的算“段后”。改完到“学生”页点“班级分析”即可看到结果，也可以直接在那个页面顶部改。</p>\
</div>\
<div class="panel">\
<h2>快捷班级</h2>\
<div class="shortcut-editor">\
<input id="shortcutClasses" value="${esc((s.shortcutClasses||[]).join(','))}" placeholder="01,02,10">\
<button class="primary" id="saveShortcuts">保存快捷班级</button>\
</div>\
</div>\
<div class="panel">\
<h2 class="with-help">数据身份 ${panelHelpBtn('settings.identity','数据身份的说明')}</h2>\
<p class="hint" id="identityStatus">${esc(identityStatusText())}</p>\
${aliasPanelHtml()}\
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
  bindPanelHelp();
  // 备选编号的折叠块：记住展开状态与滚动位置（重绘后保持展开，不会“删一条就收起来”）
  const aliasFold=$('#view-settings .alias-fold');
  if(aliasFold){
    aliasFold.addEventListener('toggle',()=>{aliasFoldOpen=aliasFold.open;});
    const box=aliasFold.querySelector('.alias-list');
    if(box&&aliasFoldOpen)box.scrollTop=aliasListScroll;
  }
  $('#toggleAdvanced').onclick=()=>{state.settingsAdvanced=!state.settingsAdvanced;renderSettings();};
  $('#historyRuleHelpBtn').onclick=()=>openHistoryRuleHelp();
  $('#resetSettings').onclick=async()=>{state.settings=mergeConfig();await DB.put({id:'main',...state.settings});renderSettings();refreshCandidatesAfterSettings();toast('已恢复默认参数');};$('#saveShortcuts').onclick=async()=>{state.settings.shortcutClasses=$('#shortcutClasses').value.split(/[,，\s]+/).map(v=>normalizeClassName(v)).filter((v,i,a)=>v&&a.indexOf(v)===i);await DB.put({id:'main',...state.settings});render();};$('#forceUpdateBtn').onclick=forceAppUpdate;$('#clearAllSettingsBtn').onclick=clearAll;
  // 备选编号（学号/考号）的查看与清理：删掉某一条，或整族清除
  $$('#view-settings [data-del-alias-student]').forEach(b=>b.onclick=async()=>{
    const sid=String(b.dataset.delAliasStudent||'');
    const value=String(b.dataset.delAliasValue||'');
    const s=state.students.find(x=>x.id===sid);
    if(!s){toast('这条编号已经找不到了（可能刚被清空）');return;}
    const before=(s.ids||[]).length;
    s.ids=(s.ids||[]).filter(x=>String(x&&x.value)!==value);
    if(s.ids.length===before){toast('这条编号已经删掉了');return;}
    await DB.put('students',s);
    const box=$('#view-settings .alias-list');
    aliasListScroll=box?box.scrollTop:0;      // 重绘后回到原来的滚动位置
    renderSettings();
    toast(`已删除 ${s.displayName||s.name} 的编号 ${value}（只影响同名时辅助认人）`);
  });
  // 按“列名”单独清一列（如只清准考证号，保留同族的自定义考号）
  $$('#view-settings [data-clear-alias-type]').forEach(b=>b.onclick=async()=>{
    const type=String(b.dataset.clearAliasType||'');
    if(!await openAliasClearDialog('type',type))return;
    const touched=[];
    state.students.forEach(s=>{
      if(!Array.isArray(s.ids)||!s.ids.length)return;
      const next=s.ids.filter(x=>String((x&&x.type)||'（未标注列名）')!==type);
      if(next.length!==s.ids.length){s.ids=next;touched.push(s);}
    });
    if(touched.length)await DB.putMany('students',touched);
    const box=$('#view-settings .alias-list');
    aliasListScroll=box?box.scrollTop:0;
    renderSettings();
    toast(`已清除全校 ${touched.length} 人的「${type}」编号`);
  });
  $$('#view-settings [data-clear-alias-family]').forEach(b=>b.onclick=async()=>{
    const family=String(b.dataset.clearAliasFamily||'');
    if(!await openAliasClearDialog('family',family))return;
    const touched=[];
    state.students.forEach(s=>{
      if(!Array.isArray(s.ids)||!s.ids.length)return;
      const next=s.ids.filter(x=>idFamilyOfAlias(x)!==family);
      if(next.length!==s.ids.length){s.ids=next;touched.push(s);}
    });
    if(touched.length)await DB.putMany('students',touched);
    const box=$('#view-settings .alias-list');
    aliasListScroll=box?box.scrollTop:0;
    renderSettings();
    toast(`已清除全校 ${touched.length} 人的「${family}」编号`);
  });
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
