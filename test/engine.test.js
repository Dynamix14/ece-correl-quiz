// Behaviour tests for the quiz engine: exam assembly, difficulty handling, and
// weak-area ranking. These cover the bugs the pre-2026 app shipped (exams that
// silently came up short when a difficulty filter was set, weak-area runs that
// recommended untouched topics).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

// data.js and engine.js are local versioned assets, not user input.
vm.runInThisContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8') + '\n;globalThis.QUESTION_BANK = QUESTION_BANK;');
const ENGINE = require(path.join(root, 'engine.js'));

const { TOS_CONFIG, TOPICS } = ENGINE;
const DIFFS = ['all', 'easy', 'medium', 'hard'];
const noDuplicates = questions => new Set(questions).size === questions.length;

test('blueprint exams return exactly the requested length at every difficulty', () => {
  ['elecs', 'est'].forEach(mode => {
    DIFFS.forEach(difficulty => {
      [100, 50, 25, 10].forEach(qCount => {
        const built = ENGINE.buildExam(mode, { qCount, difficulty });
        assert.equal(built.questions.length, qCount,
          `${mode}/${difficulty}/${qCount}: got ${built.questions.length} questions`);
        assert.equal(built.shortfall, 0, `${mode}/${difficulty}/${qCount}: reported a shortfall`);
        assert.ok(noDuplicates(built.questions), `${mode}/${difficulty}/${qCount}: repeated a question`);
      });
    });
  });
});

test('blueprint exams keep TOS section order and per-section counts', () => {
  ['elecs', 'est'].forEach(mode => {
    const built = ENGINE.buildExam(mode, { qCount: 100, difficulty: 'all' });
    const order = TOS_CONFIG[mode].sections.map(s => s.label);
    let cursor = 0;
    TOS_CONFIG[mode].sections.forEach((section, i) => {
      const inSection = built.questions.slice(cursor).filter(q => q.tosSection === section.label);
      assert.ok(inSection.length > 0, `${mode}: section "${section.label}" is empty`);
      // Section order must follow the blueprint, not the shuffle.
      order.slice(0, i + 1).forEach(seen => {
        const firstAfter = built.questions.slice(cursor + inSection.length).find(q => q.tosSection === seen);
        assert.equal(firstAfter, undefined, `${mode}: section "${seen}" reappears after "${section.label}"`);
      });
      assert.equal(inSection[0].tosItemTotal, inSection.length,
        `${mode}/${section.label}: tosItemTotal ${inSection[0].tosItemTotal} != ${inSection.length}`);
      cursor += inSection.length;
    });
    assert.equal(cursor, built.questions.length, `${mode}: ${built.questions.length - cursor} unlabelled questions`);
  });
});

test('exam section counts match the blueprint allocation at 100 items', () => {
  Object.entries(TOS_CONFIG).forEach(([mode, cfg]) => {
    const built = ENGINE.buildExam(mode, { qCount: 100, difficulty: 'all' });
    cfg.sections.forEach(section => {
      const n = built.questions.filter(q => q.tosSection === section.label).length;
      assert.equal(n, section.count, `${mode}/${section.label}: ${n} items for a ${section.count}-item section`);
    });
  });
});

test('trial exams fill the requested length without duplicates', () => {
  DIFFS.forEach(difficulty => {
    [100, 50, 12].forEach(qCount => {
      const built = ENGINE.buildTrial({ qCount, difficulty });
      assert.equal(built.questions.length, qCount, `trial/${difficulty}/${qCount}`);
      assert.ok(noDuplicates(built.questions), `trial/${difficulty}/${qCount}: duplicate question`);
    });
  });
});

test('topic quizzes respect the strict difficulty filter', () => {
  const built = ENGINE.buildTopic({ qCount: 10, difficulty: 'hard' }, ['Digital Communications']);
  const available = ENGINE.TOPIC_BY_NAME.get('Digital Communications').filter(q => q.diff === 'hard').length;
  assert.equal(built.questions.length, Math.min(10, available));
  built.questions.forEach(q => assert.equal(q.diff, 'hard'));
});

test('weak areas only rank attempted topics', () => {
  const stats = new Map();
  ENGINE.bindStats(stats);

  // Attempt five Signals & Systems items, all wrong.
  ENGINE.TOPIC_BY_NAME.get('Signals & Systems').slice(0, 5).forEach(q => {
    stats.set(ENGINE.ID_OF.get(q), { n: 1, ok: 0, last: Date.now(), missed: 1 });
  });

  const built = ENGINE.buildWeak({ qCount: 10, difficulty: 'all' });
  assert.ok(built.questions.length > 0);
  const topics = new Set(built.questions.map(q => ENGINE.META_OF.get(q).topic));
  assert.deepEqual([...topics], ['Signals & Systems'],
    `weak-area run pulled unattempted topics: ${[...topics].join(', ')}`);

  // With a stronger topic present, the weaker one still wins the slot.
  ENGINE.TOPIC_BY_NAME.get('Microprocessors').slice(0, 10).forEach(q => {
    stats.set(ENGINE.ID_OF.get(q), { n: 2, ok: 2, last: Date.now(), missed: 0 });
  });
  const second = ENGINE.buildWeak({ qCount: 10, difficulty: 'all' });
  const secondTopics = second.questions.map(q => ENGINE.META_OF.get(q).topic);
  assert.ok(secondTopics.includes('Signals & Systems'), 'the 0% topic should still be drilled first');
  assert.ok(!secondTopics.includes('Antenna Theory'), 'an untouched topic must not appear');
});

test('weak areas fall back to untouched topics only when nothing was answered', () => {
  ENGINE.bindStats(new Map());
  const built = ENGINE.buildWeak({ qCount: 10, difficulty: 'all' });
  assert.ok(built.questions.length > 0);
  assert.ok(/never opened/i.test(built.notice), `expected the cold-start notice, got: ${built.notice}`);
});

test('difficulty filter never empties a topic quiz silently', () => {
  // Logic Circuits has no hard items; a hard-only topic quiz must return zero,
  // and the caller is told so rather than being handed an empty quiz.
  const built = ENGINE.buildTopic({ qCount: 10, difficulty: 'hard' }, ['Logic Circuits and Switching Theories']);
  assert.equal(built.questions.length, 0);
  assert.equal(built.requested, 10);
});

test('allocation helpers sum to the requested total', () => {
  [1, 3, 10, 37, 100].forEach(total => {
    const weights = [44, 30, 10, 7, 3];
    const parts = ENGINE.distribute(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `distribute(${total})`);
    assert.ok(parts.every(p => p >= 0));
  });
  [10, 25, 50, 100].forEach(n => {
    const alloc = ENGINE.sectionAllocation(TOS_CONFIG.elecs, n);
    assert.equal(alloc.reduce((a, b) => a + b, 0), n, `sectionAllocation(${n})`);
  });
});
