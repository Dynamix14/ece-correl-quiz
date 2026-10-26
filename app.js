// ECE Correl Quiz Trainer — UI + session state.
// Data: data.js   Selection/exam logic: engine.js   This file: rendering, history, keyboard.
// All three are classic scripts, so index.html works when opened straight from disk.

const {
  TOPICS, ID_OF, META_OF, TOPIC_BY_NAME,
  topicProgress, shuffle
} = QUIZ_ENGINE;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const letter = i => String.fromCharCode(65 + i);
const $ = id => document.getElementById(id);

QUIZ_ENGINE.validateBank().forEach(p => console.error('Bank problem —', p));

/* ---------------------------------------------------------------------------
 * Storage: localStorage can throw (file:// origin, private browsing, disabled
 * storage). Nothing in here is allowed to take the whole script down.
 * ------------------------------------------------------------------------- */
const safeStore = {
  get(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { console.warn('localStorage unavailable:', e.message); return null; }
  },
  set(key, val) {
    try { window.localStorage.setItem(key, val); return true; }
    catch (e) { console.warn('localStorage write failed:', e.message); return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); }
    catch (e) { console.warn('localStorage remove failed:', e.message); }
  }
};

const HISTORY_KEY = 'correlQuizHistory';
const HISTORY_VERSION = 2;
const HISTORY_CAP = 400; // per topic; keeps localStorage far below quota

const stats = new Map();   // id -> {n, ok, last, missed}
let history = loadHistory();
QUIZ_ENGINE.bindStats(stats);

function loadHistory() {
  const empty = { v: HISTORY_VERSION, topics: {} };
  let raw;
  try { raw = JSON.parse(safeStore.get(HISTORY_KEY) || 'null'); }
  catch (e) { console.warn('Corrupt quiz history, starting fresh.'); return empty; }
  if (!raw || typeof raw !== 'object') return empty;

  // v1 stored {topic: [{index, q, correct, timestamp}]}. Map the old array index
  // onto the stable id at the same position so real progress survives the upgrade.
  if (!raw.v) {
    const migrated = { v: HISTORY_VERSION, topics: {} };
    let kept = 0, dropped = 0;
    Object.entries(raw).forEach(([topic, entries]) => {
      const bank = TOPIC_BY_NAME.get(topic);
      if (!bank || !Array.isArray(entries)) { if (Array.isArray(entries)) dropped += entries.length; return; }
      migrated.topics[topic] = [];
      entries.forEach(e => {
        const q = bank[e && e.index];
        if (!q) { dropped++; return; }
        migrated.topics[topic].push({ id: ID_OF.get(q), c: !!e.correct, t: e.timestamp || Date.now() });
        kept++;
      });
    });
    console.info(`History migrated to v2: ${kept} entries kept, ${dropped} dropped.`);
    return migrated;
  }

  if (!raw.topics || typeof raw.topics !== 'object') return empty;
  const clean = { v: HISTORY_VERSION, topics: {} };
  Object.entries(raw.topics).forEach(([topic, entries]) => {
    if (!Array.isArray(entries)) return;
    clean.topics[topic] = entries.filter(e => e && typeof e.id === 'string').slice(-HISTORY_CAP);
  });
  return clean;
}

function saveHistory() {
  return safeStore.set(HISTORY_KEY, JSON.stringify(history));
}

function rebuildStats() {
  stats.clear();
  Object.values(history.topics).forEach(entries => {
    entries.forEach(e => {
      const s = stats.get(e.id) || { n: 0, ok: 0, last: 0, missed: 0 };
      s.n++;
      if (e.c) s.ok++; else s.missed++;
      s.last = Math.max(s.last, e.t || 0);
      stats.set(e.id, s);
    });
  });
}

function recordAnswer(q, correct) {
  const topic = META_OF.get(q).topic;
  const id = ID_OF.get(q);
  if (!history.topics[topic]) history.topics[topic] = [];
  const log = history.topics[topic];
  log.push({ id, c: !!correct, t: Date.now() });
  if (log.length > HISTORY_CAP) log.splice(0, log.length - HISTORY_CAP);
  saveHistory();

  const s = stats.get(id) || { n: 0, ok: 0, last: 0, missed: 0 };
  s.n++;
  if (correct) s.ok++; else s.missed++;
  s.last = Date.now();
  stats.set(id, s);
}

/* ---------------------------------------------------------------------------
 * App state
 * ------------------------------------------------------------------------- */
let currentMode = 'topic';
let selectedTopics = [];
let quiz = null;        // {questions, index, answers, score, startedAt, pace, mode, notice}
let clockId = null;
let questionDeadline = 0;
let questionStartedAt = 0;

const VIEWS = ['viewHome', 'viewQuiz', 'viewResults', 'viewStudy'];
function showView(name) {
  VIEWS.forEach(v => $(v).classList.toggle('active', v === name));
  if (name !== 'viewQuiz') stopClock();
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------------------------
 * Home
 * ------------------------------------------------------------------------- */
function renderBankLine() {
  const total = TOPICS.reduce((n, t) => n + QUESTION_BANK[t].length, 0);
  $('bankLine').innerHTML = `<span>${total}</span> questions · <span>${TOPICS.length}</span> topics · offline, no install`;
}

function renderTopicGrid() {
  const grid = $('topicGrid');
  grid.innerHTML = '';
  TOPICS.forEach(topic => {
    const on = selectedTopics.includes(topic);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'topic-btn' + (on ? ' active' : '');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.dataset.topic = topic;
    btn.innerHTML = `<span>${esc(topic)}</span><div class="count"></div>`;
    btn.addEventListener('click', () => toggleTopic(topic, btn));
    grid.appendChild(btn);
  });
  refreshTopicCounts();
}

function toggleTopic(topic, btn) {
  if (selectedTopics.includes(topic)) {
    selectedTopics = selectedTopics.filter(t => t !== topic);
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  } else {
    selectedTopics.push(topic);
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
  }
}

function refreshTopicCounts() {
  document.querySelectorAll('.topic-btn').forEach(btn => {
    const p = topicProgress(btn.dataset.topic);
    const acc = p.accuracy == null ? 'not started' : `${Math.round(p.accuracy * 100)}% correct`;
    btn.querySelector('.count').textContent = `${p.total} questions · ${p.seen} seen · ${acc}`;
  });
}

function renderDashboard() {
  let attempts = 0, correct = 0, seen = 0, total = 0;
  const rows = TOPICS.map(topic => {
    const p = topicProgress(topic);
    attempts += p.attempts; correct += p.correct; seen += p.seen; total += p.total;
    return p;
  }).sort((a, b) => {
    if (a.accuracy == null && b.accuracy == null) return a.topic.localeCompare(b.topic);
    if (a.accuracy == null) return 1;
    if (b.accuracy == null) return -1;
    return a.accuracy - b.accuracy;
  });

  const overall = attempts ? Math.round((correct / attempts) * 100) : null;
  const bar = pct => {
    const cls = pct >= 75 ? '' : (pct >= 50 ? 'mid' : 'low');
    return `<div class="bar"><span class="${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
  };

  $('dashBody').innerHTML = `
    <div class="stats" style="justify-content:flex-start;margin-bottom:16px">
      <div class="stat-item"><div class="val">${overall == null ? '—' : overall + '%'}</div><div class="lbl">overall accuracy</div></div>
      <div class="stat-item"><div class="val">${attempts}</div><div class="lbl">answers recorded</div></div>
      <div class="stat-item"><div class="val">${seen}/${total}</div><div class="lbl">questions seen</div></div>
    </div>
    <table>
      <thead><tr><th>Topic</th><th class="num">Seen</th><th class="num">Accuracy</th><th>Mastery</th></tr></thead>
      <tbody>${rows.map(p => `<tr>
        <td>${esc(p.topic)}</td>
        <td class="num">${p.seen}/${p.total}</td>
        <td class="num">${p.accuracy == null ? '—' : Math.round(p.accuracy * 100) + '%'}</td>
        <td>${p.accuracy == null ? '<span class="empty">not started</span>' : bar(p.accuracy * 100)}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function renderHome() {
  renderTopicGrid();
  renderDashboard();
}

/* ---------------------------------------------------------------------------
 * Modes
 * ------------------------------------------------------------------------- */
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('topicView').style.display = mode === 'topic' ? 'block' : 'none';
  updateDifficultyNotice();
  if (mode === 'study') {
    renderStudy();
    showView('viewStudy');
  } else {
    showView('viewHome');
  }
}

function updateDifficultyNotice() {
  const el = $('diffNotice');
  const diff = $('difficulty').value;
  const isExam = currentMode === 'elecs' || currentMode === 'est' || currentMode === 'trial';
  if (!isExam || diff === 'all') { el.style.display = 'none'; return; }
  const thin = TOPICS.filter(t => !QUESTION_BANK[t].some(q => q.diff === diff)).length;
  el.style.display = 'block';
  el.innerHTML = thin
    ? `Thin pool: <strong>${thin}</strong> of ${TOPICS.length} topics have no ${esc(diff)} questions, so those sections are filled from the other difficulties. The exam still matches its blueprint length.`
    : `Sections whose ${esc(diff)} pool is too small get filled from the other difficulties, so the exam still matches its blueprint length.`;
}

/* ---------------------------------------------------------------------------
 * Quiz
 * ------------------------------------------------------------------------- */
function readControls() {
  return {
    qCount: parseInt($('qCount').value, 10) || 10,
    difficulty: $('difficulty').value,
    pace: parseInt($('pace').value, 10) || 0
  };
}

function startQuiz() {
  if (currentMode === 'study') { setMode('study'); return; }
  const settings = readControls();

  if (currentMode === 'topic' && selectedTopics.length === 0) {
    alert('Select at least one topic first.');
    return;
  }

  let built;
  if (currentMode === 'topic') built = QUIZ_ENGINE.buildTopic(settings, selectedTopics);
  else if (currentMode === 'trial') built = QUIZ_ENGINE.buildTrial(settings);
  else if (currentMode === 'elecs' || currentMode === 'est') built = QUIZ_ENGINE.buildExam(currentMode, settings);
  else if (currentMode === 'weak') built = QUIZ_ENGINE.buildWeak(settings);
  else built = QUIZ_ENGINE.buildTopic(settings, []);

  if (!built.questions.length) {
    alert('No questions matched that filter. Try "All" difficulty or another topic.');
    return;
  }

  let notice = built.notice || '';
  if (built.shortfall > 0) {
    notice = `Only ${built.questions.length} of ${built.requested} items were available from this bank${notice ? '. ' + notice : '.'}`;
  }

  quiz = {
    questions: built.questions,
    index: 0,
    answers: [],
    score: 0,
    startedAt: Date.now(),
    pace: settings.pace,
    mode: currentMode,
    difficulty: settings.difficulty,
    notice
  };
  showView('viewQuiz');
  startClock();
  renderQuestion();
}

/* ---------------------------------------------------------------------------
 * Timer: elapsed always; optional per-item countdown that auto-skips on expiry.
 * ------------------------------------------------------------------------- */
function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startClock() {
  stopClock();
  questionStartedAt = Date.now();
  questionDeadline = quiz.pace ? questionStartedAt + quiz.pace * 1000 : 0;
  tickClock();
  clockId = setInterval(tickClock, 500);
}

function stopClock() {
  if (clockId) clearInterval(clockId);
  clockId = null;
}

function tickClock() {
  if (!quiz) return;
  const el = $('quizTimer');
  if (quiz.pace) {
    const left = questionDeadline - Date.now();
    el.textContent = fmtClock(left);
    el.classList.toggle('warn', left <= quiz.pace * 250 && left > quiz.pace * 100);
    el.classList.toggle('danger', left <= quiz.pace * 100);
    if (left <= 0) {
      el.classList.remove('warn', 'danger');
      if (!currentQuestionAnswered()) answerQuestion(null); // time-out counts as skipped
      nextQuestion();
    }
  } else {
    el.textContent = fmtClock(Date.now() - quiz.startedAt);
    el.classList.remove('warn', 'danger');
  }
}

const currentQuestion = () => quiz.questions[quiz.index];
const currentQuestionAnswered = () => quiz.answers.length > quiz.index;

/* ---------------------------------------------------------------------------
 * Rendering a question
 * ------------------------------------------------------------------------- */
function renderQuestion() {
  const q = currentQuestion();
  const total = quiz.questions.length;
  const pct = Math.round((quiz.index / total) * 100);

  $('progressFill').style.width = pct + '%';
  $('progressBar').setAttribute('aria-valuenow', String(pct));

  const head = [];
  if (q.tosSection) head.push(`TOS: ${q.tosSection}${q.tosItemNum ? ` — item ${q.tosItemNum} of ${q.tosItemTotal}` : ''}`);
  head.push(`Question ${quiz.index + 1} of ${total}`);
  head.push(String(q.diff || '').toUpperCase());
  head.push(`Score ${quiz.score}`);
  $('quizMeta').textContent = head.join(' · ');

  $('questionCard').innerHTML = `
    ${q.tosSection ? `<div class="tos-badge">TOS: ${esc(q.tosSection)}</div>` : ''}
    <div class="question-num">${esc(META_OF.get(q).topic)}</div>
    <div class="question-text" id="questionText" tabindex="-1">${esc(q.q)}${q.img ? `<img class="qfig" src="${esc(q.img)}" alt="Circuit figure for this question">` : ''}</div>
    <div class="options" id="options" role="group" aria-label="Answer choices">
      ${q.options.map((opt, i) => `
        <button type="button" class="option-btn" data-index="${i}" aria-keyshortcuts="${letter(i)} ${i + 1}">
          <span class="key">${letter(i)}</span>${esc(opt)}
        </button>`).join('')}
    </div>
    <div class="explanation" id="explanation"></div>
    <p class="sr-only" id="liveStatus" aria-live="polite"></p>
  `;

  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => answerQuestion(parseInt(btn.dataset.index, 10)));
  });

  $('nextBtn').style.display = 'none';
  $('skipBtn').style.display = '';
  if (quiz.notice) {
    const p = document.createElement('p');
    p.className = 'notice';
    p.style.marginTop = '12px';
    p.textContent = quiz.notice;
    $('questionCard').appendChild(p);
    quiz.notice = '';
  }
  const stem = $('questionText');
  if (stem) stem.focus({ preventScroll: true });
}

function answerQuestion(idx) {
  if (!quiz || currentQuestionAnswered()) return;
  const q = currentQuestion();
  const correct = idx !== null && idx === q.answer;
  if (correct) quiz.score++;

  document.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
    if (i === q.answer) btn.classList.add('correct');
    else if (i === idx) btn.classList.add('wrong');
  });

  quiz.answers.push({ q, picked: idx, correct, skipped: idx === null, ms: Date.now() - questionStartedAt });
  recordAnswer(q, correct);

  const ex = $('explanation');
  let html = `<h4 class="${correct ? 'ok' : 'bad'}">${correct ? 'Correct' : (idx === null ? 'Skipped' : 'Incorrect')}</h4>`;
  html += `<p>${esc(q.exp || '')}</p>`;
  if (!correct) html += `<p class="why-wrong">Correct answer: ${letter(q.answer)}. ${esc(q.options[q.answer])}</p>`;

  if (q.why && q.why.some(x => x)) {
    html += `<div class="opt-review"><div class="hdr">${correct ? 'Why the other options are wrong' : 'Every option, and why'}</div>`;
    q.options.forEach((opt, i) => {
      const why = (q.why && q.why[i]) ? q.why[i] : '';
      if (!why) return; // never invent an explanation the bank does not carry
      const cls = i === idx ? 'picked' : (i === q.answer ? 'right' : 'other');
      html += `<div class="opt-row ${cls}"><span class="opt-key">${letter(i)}</span><span>${esc(why)}</span></div>`;
    });
    html += '</div>';
  }
  if (q.src) html += `<div class="source-line">Source: ${esc(q.src)}</div>`;
  ex.innerHTML = html;
  ex.classList.add('show');

  const live = $('liveStatus');
  if (live) live.textContent = correct ? 'Correct.' : `Incorrect. The answer is ${letter(q.answer)}.`;

  $('skipBtn').style.display = 'none';
  const next = $('nextBtn');
  next.style.display = '';
  next.textContent = quiz.index + 1 >= quiz.questions.length ? 'See results' : 'Next';
  next.focus({ preventScroll: true });
}

function nextQuestion() {
  if (!quiz) return;
  if (!currentQuestionAnswered()) answerQuestion(null); // unanswered always counts as skipped
  quiz.index++;
  if (quiz.index >= quiz.questions.length) {
    showResults();
    return;
  }
  if (quiz.pace) {
    questionStartedAt = Date.now();
    questionDeadline = questionStartedAt + quiz.pace * 1000;
  }
  renderQuestion();
}

/* ---------------------------------------------------------------------------
 * Results
 * ------------------------------------------------------------------------- */
function showResults() {
  stopClock();
  showView('viewResults');

  const total = quiz.questions.length;
  const answered = quiz.answers.filter(a => !a.skipped).length;
  const pct = total ? Math.round((quiz.score / total) * 100) : 0;
  const elapsed = Date.now() - quiz.startedAt;

  const titles = {
    elecs: 'ELECS Trial complete', est: 'EST Trial complete', trial: 'Trial exam complete',
    weak: 'Weak-area drill complete', topic: 'Quiz complete'
  };
  $('resultTitle').textContent = titles[quiz.mode] || 'Quiz complete';
  $('scoreBig').textContent = `${quiz.score}/${total} (${pct}%)`;
  $('scoreStats').innerHTML = `
    <div class="stat-item"><div class="val" style="color:var(--accent2)">${quiz.score}</div><div class="lbl">correct</div></div>
    <div class="stat-item"><div class="val" style="color:var(--danger)">${answered - quiz.score}</div><div class="lbl">wrong</div></div>
    <div class="stat-item"><div class="val">${total - answered}</div><div class="lbl">skipped</div></div>
    <div class="stat-item"><div class="val">${fmtClock(elapsed)}</div><div class="lbl">total time</div></div>
    <div class="stat-item"><div class="val">${fmtClock(total ? elapsed / total : 0)}</div><div class="lbl">per item</div></div>
  `;

  const breakdown = $('sectionBreakdown');
  const rows = new Map();
  quiz.answers.forEach(a => {
    const label = a.q.tosSection;
    if (!label) return;
    const r = rows.get(label) || { label, n: 0, ok: 0 };
    r.n++;
    if (a.correct) r.ok++;
    rows.set(label, r);
  });
  if (rows.size) {
    breakdown.style.display = 'block';
    breakdown.innerHTML = `<h3>By section</h3>
      <table><thead><tr><th>Section</th><th class="num">Correct</th><th class="num">Items</th><th class="num">%</th></tr></thead>
      <tbody>${[...rows.values()].map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.ok}</td><td class="num">${r.n}</td><td class="num">${Math.round((r.ok / r.n) * 100)}%</td></tr>`).join('')}</tbody></table>`;
  } else {
    breakdown.style.display = 'none';
  }

  const review = $('reviewArea');
  const missed = quiz.answers.filter(a => !a.correct);
  review.innerHTML = '<h3>Review</h3>';
  if (!missed.length) review.innerHTML += '<p class="empty">Clean sweep — nothing to review.</p>';

  quiz.answers.forEach((a, i) => {
    if (a.correct) return; // the review exists to show what needs work
    const div = document.createElement('div');
    div.className = 'review-item ' + (a.skipped ? 'skipped' : 'wrong');
    const pickedLine = a.skipped
      ? '<div class="a pick-bad">Skipped (no answer given)</div>'
      : `<div class="a pick-bad">Your answer: ${letter(a.picked)}. ${esc(a.q.options[a.picked])}</div>`;
    div.innerHTML = `
      <div class="q">${i + 1}. ${esc(a.q.q)}</div>
      ${pickedLine}
      <div class="a pick-ok">Correct: ${letter(a.q.answer)}. ${esc(a.q.options[a.q.answer])}</div>
      <div class="e">${esc(a.q.exp || '')}</div>
      ${a.q.src ? `<div class="e">Source: ${esc(a.q.src)}</div>` : ''}
    `;
    review.appendChild(div);
  });
  $('backBtn').focus({ preventScroll: true });
}

/* ---------------------------------------------------------------------------
 * Study mode
 * ------------------------------------------------------------------------- */
function renderStudy() {
  const sel = $('studyTopic');
  if (sel.options.length === 0) {
    sel.innerHTML = TOPICS.map(t => `<option value="${esc(t)}">${esc(t)} (${QUESTION_BANK[t].length})</option>`).join('');
  }
  const topic = TOPICS.includes(sel.value) ? sel.value : TOPICS[0];
  const filter = $('studyFilter').value;

  let list = QUESTION_BANK[topic].slice();
  if (filter === 'hard') list = list.filter(q => q.diff === 'hard');
  else if (filter === 'missed') list = list.filter(q => { const s = stats.get(ID_OF.get(q)); return s && s.missed > 0; });
  else if (filter === 'unseen') list = list.filter(q => !stats.has(ID_OF.get(q)));

  $('studyCount').textContent = list.length
    ? `${list.length} question${list.length === 1 ? '' : 's'} — answers shown.`
    : 'Nothing matches that filter.';

  $('studyList').innerHTML = list.map(q => {
    const s = stats.get(ID_OF.get(q));
    const notes = (q.why || []).map((w, i) => w ? `<div><strong>${letter(i)}.</strong> ${esc(w)}</div>` : '').join('');
    return `<article class="study-item">
      <div class="q">${esc(q.q)}</div>
      ${q.img ? `<img class="qfig" src="${esc(q.img)}" alt="Circuit figure for this question">` : ''}
      <ol type="A">${q.options.map((o, i) => `<li class="${i === q.answer ? 'key' : ''}">${esc(o)}${i === q.answer ? ' ✓' : ''}</li>`).join('')}</ol>
      <p style="margin-top:10px">${esc(q.exp || '')}</p>
      ${notes ? `<div class="notes">${notes}</div>` : ''}
      <div class="meta">
        <span>${esc(String(q.diff || '').toUpperCase())}</span>
        <span>${esc(q.src || 'source not recorded')}</span>
        ${s ? `<span>seen ${s.n}× · ${s.ok} right · ${s.missed} wrong</span>` : '<span>never attempted</span>'}
      </div>
    </article>`;
  }).join('');
}

/* ---------------------------------------------------------------------------
 * Export / import
 * ------------------------------------------------------------------------- */
function exportHistory() {
  const payload = { app: 'ece-correl-quiz', v: HISTORY_VERSION, exportedAt: new Date().toISOString(), topics: history.topics };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `correl-quiz-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importHistory(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(String(reader.result)); }
    catch (e) { alert('That file is not valid JSON.'); return; }
    if (!data || !data.topics || typeof data.topics !== 'object') {
      alert('That file does not look like a progress export.');
      return;
    }
    let added = 0;
    Object.entries(data.topics).forEach(([topic, entries]) => {
      if (!Array.isArray(entries) || !TOPIC_BY_NAME.has(topic)) return;
      if (!history.topics[topic]) history.topics[topic] = [];
      const known = new Set(history.topics[topic].map(e => `${e.id}:${e.t}`));
      entries.forEach(e => {
        if (!e || typeof e.id !== 'string') return;
        const key = `${e.id}:${e.t}`;
        if (known.has(key)) return; // union import, so re-importing is harmless
        known.add(key);
        history.topics[topic].push({ id: e.id, c: !!e.c, t: e.t || Date.now() });
        added++;
      });
      const log = history.topics[topic];
      if (log.length > HISTORY_CAP) log.splice(0, log.length - HISTORY_CAP);
    });
    saveHistory();
    rebuildStats();
    renderHome();
    alert(`Imported ${added} new answer record${added === 1 ? '' : 's'}.`);
  };
  reader.readAsText(file);
}

function resetHistory() {
  if (!confirm('Reset all quiz history? This clears progress, mastery, and weak-area ranking.')) return;
  history = { v: HISTORY_VERSION, topics: {} };
  safeStore.remove(HISTORY_KEY);
  rebuildStats();
  renderHome();
}

/* ---------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------- */
function leaveQuiz() {
  quiz = null;
  setMode(currentMode === 'study' ? 'topic' : currentMode);
}

function bindEvents() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('startBtn').addEventListener('click', startQuiz);
  $('againBtn').addEventListener('click', startQuiz);
  $('backBtn').addEventListener('click', leaveQuiz);
  $('quitBtn').addEventListener('click', () => {
    if (quiz && quiz.index > 0 && !confirm('Quit this quiz? Answered questions stay in your history.')) return;
    leaveQuiz();
  });
  $('skipBtn').addEventListener('click', () => { if (quiz) nextQuestion(); });
  $('nextBtn').addEventListener('click', nextQuestion);
  $('difficulty').addEventListener('change', updateDifficultyNotice);
  $('exportBtn').addEventListener('click', exportHistory);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) importHistory(f);
    e.target.value = '';
  });
  $('resetBtn').addEventListener('click', resetHistory);
  $('studyTopic').addEventListener('change', renderStudy);
  $('studyFilter').addEventListener('change', renderStudy);
  $('studyBackBtn').addEventListener('click', () => setMode('topic'));

  document.addEventListener('keydown', e => {
    if (!$('viewQuiz').classList.contains('active') || !quiz) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if (e.key === 'Escape') { e.preventDefault(); $('quitBtn').click(); return; }

    if (!currentQuestionAnswered()) {
      const k = e.key.toLowerCase();
      let idx = -1;
      if (/^[a-d]$/.test(k)) idx = k.charCodeAt(0) - 97;
      else if (/^[1-4]$/.test(k)) idx = parseInt(k, 10) - 1;
      if (idx >= 0 && idx < currentQuestion().options.length) {
        e.preventDefault();
        answerQuestion(idx);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      nextQuestion();
    }
  });
}

function init() {
  rebuildStats();
  renderBankLine();
  renderHome();
  bindEvents();
  setMode('topic');
}

init();
