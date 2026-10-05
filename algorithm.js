// 点名算法配置：难度区间使用班级位次分位数，不使用成绩率。
const ALGORITHM_DEFAULTS = {
  configVersion: 3, candidateCount: 3, historyWindow: 20,
  recentDecay: 0.58, recoveryPerCall: 0.12, focusBoost: 1.65, basisExamCount: 3, historyRule: 'twoMonths', lowScorePercentile: 0.60, zeroRecentBoost: 1.5, shortcutClasses: [],
  difficulty: {
    1: { minPercentile: 0.60, maxPercentile: 1.00 },
    2: { minPercentile: 0.25, maxPercentile: 0.75 },
    3: { minPercentile: 0.00, maxPercentile: 0.35 }
  }
};
function mergeConfig(saved) {
  const source = saved || {};
  const savedDifficulty = source.difficulty || {};
  const difficulty = {};
  [1, 2, 3].forEach(key => {
    const fallback = ALGORITHM_DEFAULTS.difficulty[key];
    const savedRange = savedDifficulty[key] || {};
    const min=Number(savedRange.minPercentile),max=Number(savedRange.maxPercentile);
    const safeMin=Number.isFinite(min)?Math.max(0,Math.min(1,min)):fallback.minPercentile;
    const safeMax=Number.isFinite(max)?Math.max(safeMin,Math.min(1,max)):fallback.maxPercentile;
    difficulty[key] = { minPercentile:safeMin, maxPercentile:safeMax };
  });
  const next = { ...ALGORITHM_DEFAULTS, ...source, configVersion: 3, difficulty };
  const numeric=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  next.candidateCount=Math.max(1,Math.min(12,numeric(next.candidateCount,ALGORITHM_DEFAULTS.candidateCount)));
  next.recentDecay=Math.max(0,Math.min(0.999,numeric(next.recentDecay,ALGORITHM_DEFAULTS.recentDecay)));
  next.recoveryPerCall=Math.max(0,Math.min(1,numeric(next.recoveryPerCall,ALGORITHM_DEFAULTS.recoveryPerCall)));
  next.focusBoost=Math.max(0,numeric(next.focusBoost,ALGORITHM_DEFAULTS.focusBoost));
  next.basisExamCount=Math.max(1,Math.min(50,numeric(next.basisExamCount,ALGORITHM_DEFAULTS.basisExamCount)));
  next.lowScorePercentile=Math.max(0,Math.min(1,numeric(next.lowScorePercentile,ALGORITHM_DEFAULTS.lowScorePercentile)));
  next.zeroRecentBoost=Math.max(0,numeric(next.zeroRecentBoost,ALGORITHM_DEFAULTS.zeroRecentBoost));
  next.shortcutClasses = Array.isArray(next.shortcutClasses) ? next.shortcutClasses : [];
  next.historyRule = ['calls20','calls30','calls50','week','twoWeeks','month','twoMonths','threeMonths','halfYear','all'].includes(String(next.historyRule)) ? String(next.historyRule) : 'twoMonths';
  return next;
}
function recentHistoryEntries(history, studentId, config) {
  const rows = history.filter(x => x.studentId === studentId).sort((a,b) => String(b.at).localeCompare(String(a.at)));
  const rule = String(config?.historyRule || 'twoMonths');
  if (rule === 'all') return rows;
  if (rule.startsWith('calls')) return rows.slice(0, Math.max(1, Number(rule.slice(5)) || 20));
  const days = rule === 'week' ? 7 : rule === 'twoWeeks' ? 14 : rule === 'month' ? 30 : rule === 'twoMonths' ? 60 : rule === 'threeMonths' ? 90 : rule === 'halfYear' ? 182 : 60;
  const cutoff = Date.now() - days * 86400000;
  return rows.filter(x => Date.parse(x.at) >= cutoff);
}
function rankValue(student) {
  const rawRate = student?.scoreRate;
  const scoreRate = Number(rawRate);
  if (rawRate !== null && rawRate !== undefined && Number.isFinite(scoreRate)) return -scoreRate;
  const value = Number(String(student?.classRank ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}
function rankedPool(students) {
  return [...students].sort((a, b) => {
    const ar = rankValue(a), br = rankValue(b);
    if (ar === null && br === null) return String(a.id).localeCompare(String(b.id));
    if (ar === null) return 1;
    if (br === null) return -1;
    return ar - br || (Number(a.classRank) || 999999) - (Number(b.classRank) || 999999) || String(a.id).localeCompare(String(b.id));
  });
}
function difficultyRange(count, difficulty, config) {
  const range = config.difficulty[String(difficulty)] || config.difficulty[2];
  const start = Math.max(1, Math.ceil(count * Number(range.minPercentile)));
  const end = Math.min(count, Math.max(start, Math.ceil(count * Number(range.maxPercentile))));
  return { start, end };
}
function recommendationScore(student, history, config) {
  const recent = recentHistoryEntries(history, student.id, config);
  const decay = recent.reduce((total, _entry, index) => total + Math.pow(config.recentDecay, index + 1), 0);
  const cooling = Math.max(0.2, 1 - decay * Math.max(0.1, config.recoveryPerCall * 3));
  const rateFactor = Number.isFinite(Number(student.scoreRate)) ? 0.75 + Number(student.scoreRate) * 0.5 : 1;
  const lowScoreBoost = student.lowScoreNoRecent ? Number(config.zeroRecentBoost || 1) : 1;
  return Math.max(0.0001, cooling * (student.focus ? config.focusBoost : 1) * rateFactor * lowScoreBoost);
}
function weightedSample(scored, count) {
  const pool = [...scored], selected = [];
  while (pool.length && selected.length < count) {
    const total = pool.reduce((sum, item) => sum + item.score, 0);
    let cursor = Math.random() * total, index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { cursor -= pool[i].score; if (cursor <= 0) { index = i; break; } }
    selected.push(pool[index]); pool.splice(index, 1);
  }
  return selected;
}
function chooseCandidates(students, history, absences, config) {
  const absent = new Set(absences.filter(x => x.date === localDate()).map(x => x.studentId));
  // Hard rule: a student with a formal call record from today cannot be selected again today.
  const today = localDate();
  const calledToday = new Set(history.filter(x => x.studentId && timestampLocalDate(x.at) === today).map(x => x.studentId));
  const available = rankedPool(students.filter(s => !absent.has(s.id) && !calledToday.has(s.id)));
  const range = difficultyRange(available.length, config.currentDifficulty || 2, config);
  const eligible = available.slice(range.start - 1, range.end);
  const scored = eligible.map(student => ({ student, score: recommendationScore(student, history, config),
    recentCount: recentHistoryEntries(history, student.id, config).length }));
  scored.forEach((item, index) => {
    const position = available.indexOf(item.student) / Math.max(1, available.length - 1);
    item.student.lowScoreNoRecent = position >= 1 - Number(config.lowScorePercentile || 0.6)
      && item.recentCount === 0;
    item.score = recommendationScore(item.student, history, config);
  });
  return weightedSample(scored, Math.min(config.candidateCount, scored.length));
}
function timestampLocalDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
