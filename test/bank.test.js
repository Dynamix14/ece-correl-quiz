// Data-integrity tests for the ECE Correl Quiz Trainer bank.
// Run with: node --test test/
// These encode the invariants that the pre-2026 bank had silently violated
// (keyed answers contradicted by their own explanation, damaged per-option
// notes, missing provenance) so a future edit cannot regress them quietly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
// data.js is a local, versioned asset (not user input); evaluating it is the point.
// Its top-level `const` is lexically scoped, so re-export it onto the context.
vm.runInContext(source + '\n;globalThis.__BANK = QUESTION_BANK;', sandbox);
const BANK = sandbox.__BANK;
const TOPICS = Object.keys(BANK);

// Mirrors TOS_CONFIG in app.js: the exam blueprint each trial mode must honour.
const BLUEPRINT = {
  elecs: {
    total: 100,
    sections: [
      { label: 'DC', count: 14, banks: ['Electrical Circuits 1 (DC)'] },
      { label: 'AC', count: 14, banks: ['Electrical Circuits 2 (AC)'] },
      { label: 'Electrostatics', count: 8, banks: ['Electrostatics'] },
      { label: 'Magnetism', count: 8, banks: ['Magnetism'] },
      { label: 'Devices', count: 14, banks: ['Diodes & Power Supplies', 'Transistors'] },
      { label: 'Systems', count: 8, banks: ['Electronic System Design'] },
      { label: 'Logic', count: 12, banks: ['Logic Circuits and Switching Theories'] },
      { label: 'Micro', count: 12, banks: ['Microprocessors'] },
      { label: 'Control', count: 10, banks: ['Control Systems'] }
    ]
  },
  est: {
    total: 100,
    sections: [
      { label: 'Signals', count: 10, banks: ['Signals & Systems'] },
      { label: 'Comms', count: 25, banks: ['Communication Systems'] },
      { label: 'Digital', count: 15, banks: ['Digital Communications'] },
      { label: 'TL', count: 13, banks: ['Transmission Lines'] },
      { label: 'Antenna', count: 5, banks: ['Antenna Theory'] },
      { label: 'Propagation', count: 5, banks: ['Radiowave Propagation'] },
      { label: 'Systems', count: 7, banks: ['Electronic System Design'] },
      { label: 'Data', count: 20, banks: ['Data Communications'] }
    ]
  }
};

const DIFFS = new Set(['easy', 'medium', 'hard']);
// Collapse whitespace and case only. Stripping symbols would call legitimate
// distractor pairs (G = ηD vs G = D/η) duplicates.
const normalise = o => String(o).toLowerCase().replace(/\s+/g, ' ').trim();
const all = TOPICS.flatMap(t => BANK[t].map((q, i) => ({ topic: t, index: i, q })));
const id = ({ topic, index }) => `${topic}[${index}]`;

test('bank is non-trivial and covers every blueprint bank', () => {
  assert.ok(all.length > 400, `expected a full bank, got ${all.length} questions`);
  assert.ok(TOPICS.length >= 17, `expected at least 17 topics, got ${TOPICS.length}`);
  TOPICS.forEach(t => assert.ok(BANK[t].length > 0, `${t} is empty`));
  Object.values(BLUEPRINT).forEach(cfg => cfg.sections.forEach(s => s.banks.forEach(b => {
    assert.ok(BANK[b], `blueprint references missing bank: ${b}`);
  })));
});

test('every question is structurally sound', () => {
  all.forEach(item => {
    const { q } = item;
    assert.equal(typeof q.q, 'string', `${id(item)}: stem must be a string`);
    assert.ok(q.q.trim().length > 5, `${id(item)}: stem is empty`);
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, `${id(item)}: needs at least 2 options`);
    q.options.forEach((o, oi) => {
      assert.equal(typeof o, 'string', `${id(item)}: option ${oi} is not a string`);
      assert.ok(o.trim().length > 0, `${id(item)}: option ${oi} is blank`);
    });
    assert.ok(Number.isInteger(q.answer), `${id(item)}: answer must be an integer index`);
    assert.ok(q.answer >= 0 && q.answer < q.options.length, `${id(item)}: answer ${q.answer} out of range`);
    assert.ok(DIFFS.has(q.diff), `${id(item)}: unknown difficulty "${q.diff}"`);
    assert.ok(typeof q.exp === 'string' && q.exp.trim().length > 10, `${id(item)}: explanation is missing`);
    assert.ok(typeof q.src === 'string' && q.src.trim().length > 0, `${id(item)}: source is missing`);
  });
});

test('no question repeats an option inside itself', () => {
  all.forEach(item => {
    const seen = new Set();
    item.q.options.forEach(o => {
      const key = normalise(o);
      assert.ok(!seen.has(key), `${id(item)}: duplicate option "${o}"`);
      seen.add(key);
    });
  });
});

test('no duplicate stems within a topic', () => {
  TOPICS.forEach(topic => {
    const seen = new Map();
    BANK[topic].forEach((q, i) => {
      const key = q.q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      assert.ok(!seen.has(key), `${topic}[${i}] repeats the stem of ${topic}[${seen.get(key)}]`);
      seen.set(key, i);
    });
  });
});

test('per-option notes are aligned, complete, and belong to this question', () => {
  // A note may be reused only when it explains the same option text elsewhere
  // (matched question pairs share distractors). Same note on a different option
  // is a paste error.
  const noteOwner = new Map(); // note text -> normalized option text it explained
  all.forEach(item => {
    const why = item.q.why;
    if (why == null) return;
    assert.ok(Array.isArray(why), `${id(item)}: why must be an array`);
    assert.equal(why.length, item.q.options.length, `${id(item)}: why has ${why.length} entries for ${item.q.options.length} options`);
    assert.ok(!String(why[item.q.answer] || '').trim(), `${id(item)}: why[] should be blank at the correct option`);
    why.forEach((w, i) => {
      if (!w) return;
      assert.ok(w.trim().length > 8, `${id(item)}: why[${i}] is too short to say anything`);
      assert.ok(/[.!?]$/.test(w.trim()), `${id(item)}: why[${i}] looks truncated: "${w}"`);
      const open = (w.match(/\(/g) || []).length;
      const close = (w.match(/\)/g) || []).length;
      assert.equal(open, close, `${id(item)}: why[${i}] has unbalanced parentheses: "${w}"`);
      const optionText = normalise(item.q.options[i]);
      const seenOn = noteOwner.get(w.trim());
      if (seenOn !== undefined && seenOn !== optionText) {
        assert.fail(`${id(item)}: why[${i}] is copied verbatim from another question where it explained "${seenOn}", not "${optionText}"`);
      }
      noteOwner.set(w.trim(), optionText);
    });
  });
});

test('explanations do not contradict the keyed answer', () => {
  const toNum = s => {
    const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  const close = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.01;

  all.forEach(item => {
    const { q } = item;
    assert.ok(!/KEYED ANSWER/i.test(q.exp), `${id(item)}: explanation still contains a "KEYED ANSWER" caveat`);
    assert.ok(!/possible OCR/i.test(q.exp), `${id(item)}: explanation still hedges about OCR`);

    const optionNums = q.options.map(toNum);
    if (optionNums[q.answer] == null) return; // non-numeric item, nothing to cross-check
    const expNums = (q.exp.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const hits = optionNums
      .map((n, i) => (n != null && expNums.some(e => close(n, e)) ? i : -1))
      .filter(i => i >= 0);
    // If the explanation points at exactly one option value, that must be the key.
    if (hits.length === 1) {
      assert.equal(hits[0], q.answer, `${id(item)}: explanation supports ${q.options[hits[0]]} but the key is ${q.options[q.answer]}`);
    }
  });
});

test('every TOS section can actually be filled', () => {
  Object.entries(BLUEPRINT).forEach(([mode, cfg]) => {
    const total = cfg.sections.reduce((n, s) => n + s.count, 0);
    assert.equal(total, cfg.total, `${mode}: blueprint sums to ${total}, not ${cfg.total}`);
    cfg.sections.forEach(s => {
      const pool = s.banks.reduce((n, b) => n + BANK[b].length, 0);
      assert.ok(pool >= s.count, `${mode}/${s.label}: needs ${s.count} items, only ${pool} available`);
    });
  });
});

test('difficulty mix is reported so thin pools stay visible', () => {
  const counts = { easy: 0, medium: 0, hard: 0 };
  all.forEach(({ q }) => counts[q.diff]++);
  const emptyHard = TOPICS.filter(t => !BANK[t].some(q => q.diff === 'hard'));
  // Not a failure: the exam builder tops sections up from other difficulties.
  // Surfaced so the gap is a known, intentional state rather than a silent one.
  console.log(`difficulty mix: ${JSON.stringify(counts)}; topics with no hard items: ${emptyHard.length}`);
  assert.ok(counts.easy + counts.medium + counts.hard === all.length);
});
