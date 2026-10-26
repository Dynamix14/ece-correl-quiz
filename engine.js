// Quiz engine — bank indexing, question selection, and exam assembly.
// Deliberately DOM-free so it can be unit-tested with plain node (see test/engine.test.js).
// Loaded as a classic script before app.js; also exports through module.exports.

/* eslint-disable no-unused-vars */
const QUIZ_ENGINE = (function () {
  const TOPICS = Object.keys(QUESTION_BANK);

  /* ---- bank integrity ---------------------------------------------------- */
  function validateBank() {
    const problems = [];
    TOPICS.forEach(topic => {
      QUESTION_BANK[topic].forEach((q, i) => {
        const found = [];
        if (!Array.isArray(q.options) || q.options.length < 2) found.push('options');
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) found.push('answer index');
        if (!q.q) found.push('stem');
        if (found.length) problems.push(`${topic}[${i}]: ${found.join(', ')}`);
      });
    });
    return problems;
  }

  /* ---- stable identity --------------------------------------------------
   * History is keyed by a hash of the stem, never by array position: editing
   * the bank used to re-point saved progress at unrelated questions.
   * --------------------------------------------------------------------- */
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  const ID_OF = new WeakMap();
  const META_OF = new WeakMap();
  const usedIds = new Set();
  const TOPIC_BY_NAME = new Map();

  TOPICS.forEach(topic => {
    TOPIC_BY_NAME.set(topic, QUESTION_BANK[topic]);
    QUESTION_BANK[topic].forEach((q, index) => {
      let id = `${hash32(q.q)}-${index}`;
      if (usedIds.has(id)) id = `${id}-${hash32(topic)}`;
      usedIds.add(id);
      ID_OF.set(q, id);
      META_OF.set(q, { topic, index });
    });
  });

  /* ---- stats bridge ------------------------------------------------------
   * The engine never owns progress; the app hands it a Map of
   * id -> {n, ok, last, missed} and the engine reads it.
   * --------------------------------------------------------------------- */
  let statLookup = new Map();
  function bindStats(map) { statLookup = map; }
  function statFor(q) { return statLookup.get(ID_OF.get(q)); }

  function topicProgress(topic) {
    const bank = QUESTION_BANK[topic] || [];
    let attempts = 0, correct = 0, seen = 0;
    bank.forEach(q => {
      const s = statFor(q);
      if (!s) return;
      seen++;
      attempts += s.n;
      correct += s.ok;
    });
    return {
      topic,
      total: bank.length,
      seen,
      unseen: bank.length - seen,
      attempts,
      correct,
      accuracy: attempts ? correct / attempts : null
    };
  }

  /* ---- selection -------------------------------------------------------- */
  function rankPool(pool) {
    return pool
      .map(q => {
        const s = statFor(q);
        return { q, seen: s ? s.last : 0, missRate: s && s.n ? s.missed / s.n : 0 };
      })
      .sort((a, b) => {
        if (a.seen !== b.seen) return a.seen - b.seen; // never seen first, then oldest
        return b.missRate - a.missRate;                // then the ones missed most
      })
      .map(x => x.q);
  }

  /**
   * Pick `count` questions from one topic.
   * strictDifficulty=false (exam modes) tops up from the other difficulties when
   * the filtered pool is too small, so a section never silently under-delivers.
   */
  function pickQuestions(topic, count, difficulty, opts) {
    const options = opts || {};
    const bank = QUESTION_BANK[topic];
    if (!bank || count <= 0) return [];

    const pool = difficulty === 'all' ? bank.slice() : bank.filter(q => q.diff === difficulty);
    const picked = rankPool(pool).slice(0, count);

    if (picked.length < count && options.strictDifficulty === false) {
      const chosen = new Set(picked);
      picked.push(...rankPool(bank.filter(q => !chosen.has(q))).slice(0, count - picked.length));
    }
    return picked;
  }

  /** Largest-remainder allocation of `total` across weights. */
  function distribute(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const base = weights.map(w => Math.floor((w / sum) * total));
    let rem = total - base.reduce((a, b) => a + b, 0);
    const order = weights
      .map((w, i) => ({ i, frac: (w / sum) * total - base[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem; k++) base[order[k % order.length].i]++;
    return base;
  }

  /* ---- Table of Specifications ------------------------------------------ */
  const TOS_CONFIG = {
    elecs: {
      name: 'ELECS Trial Exam',
      total: 100,
      sections: [
        { label: 'DC Electrical Circuits', count: 14, bank: 'Electrical Circuits 1 (DC)' },
        { label: 'AC Electrical Circuits', count: 14, bank: 'Electrical Circuits 2 (AC)' },
        { label: 'Electromagnetics (Electricity)', count: 8, bank: 'Electrostatics' },
        { label: 'Electromagnetics (Magnetism)', count: 8, bank: 'Magnetism' },
        {
          label: 'Electronic Devices and Circuits (Diodes and Transistors)',
          count: 14,
          banks: [
            { bank: 'Diodes & Power Supplies', count: 7 },
            { bank: 'Transistors', count: 7 }
          ]
        },
        { label: 'Electronic Systems and Design', count: 8, bank: 'Electronic System Design' },
        { label: 'Logic Circuits and Switching Theory', count: 12, bank: 'Logic Circuits and Switching Theories' },
        { label: 'Microprocessor & Microcontroller Systems and Design', count: 12, bank: 'Microprocessors' },
        { label: 'Feedback and Control Systems', count: 10, bank: 'Control Systems' }
      ]
    },
    est: {
      name: 'EST Trial Exam',
      total: 100,
      sections: [
        { label: 'Signals', count: 10, bank: 'Signals & Systems' },
        { label: 'Principles of Communications', count: 25, bank: 'Communication Systems' },
        { label: 'Digital Communications', count: 15, bank: 'Digital Communications' },
        { label: 'Transmission Lines', count: 13, bank: 'Transmission Lines' },
        { label: 'Antenna Theory', count: 5, bank: 'Antenna Theory' },
        { label: 'Radiowave Propagation', count: 5, bank: 'Radiowave Propagation' },
        { label: 'Electronic Systems and Design', count: 7, bank: 'Electronic System Design' },
        { label: 'Data Communications', count: 20, bank: 'Data Communications' }
      ]
    }
  };

  function sectionAllocation(config, wanted) {
    const alloc = config.sections.map(s => Math.max(0, Math.round((s.count / config.total) * wanted)));
    let diff = wanted - alloc.reduce((a, b) => a + b, 0);
    if (diff !== 0) {
      const order = config.sections.map((s, i) => ({ i, c: s.count })).sort((a, b) => b.c - a.c);
      let k = 0;
      let guard = 0;
      while (diff !== 0 && guard++ < 10 * order.length) {
        const idx = order[k % order.length].i;
        if (diff > 0) { alloc[idx]++; diff--; }
        else if (alloc[idx] > 0) { alloc[idx]--; diff++; }
        k++;
      }
    }
    return alloc;
  }

  /** Blueprint exam: sections in TOS order, never shorter than `wanted`. */
  function buildExam(mode, settings) {
    const config = TOS_CONFIG[mode];
    if (!config) throw new Error(`unknown exam mode: ${mode}`);
    const alloc = sectionAllocation(config, settings.qCount);
    const used = new Set();
    const out = [];

    config.sections.forEach((section, si) => {
      const wanted = alloc[si];
      if (wanted <= 0) return;

      let picked = [];
      if (section.banks) {
        const sub = distribute(wanted, section.banks.map(b => b.count));
        section.banks.forEach((b, bi) => {
          picked = picked.concat(pickQuestions(b.bank, sub[bi], settings.difficulty, { strictDifficulty: false }));
        });
        picked = shuffle(picked);
      } else {
        picked = pickQuestions(section.bank, wanted, settings.difficulty, { strictDifficulty: false });
      }

      picked = picked.filter(q => !used.has(q)); // no repeats within one exam
      picked.forEach(q => used.add(q));
      picked.forEach((q, i) => {
        q.tosSection = section.label;
        q.tosItemNum = i + 1;
        q.tosItemTotal = picked.length;
      });
      out.push(...picked);
    });

    // Bank cannot fill the blueprint (too few unique items): report the shortfall
    // rather than pretending the exam is complete.
    return { questions: out, requested: settings.qCount, shortfall: Math.max(0, settings.qCount - out.length) };
  }

  function buildTrial(settings) {
    const alloc = distribute(settings.qCount, TOPICS.map(t => QUESTION_BANK[t].length));
    const used = new Set();
    let out = [];

    TOPICS.forEach((topic, i) => {
      const picked = pickQuestions(topic, alloc[i], settings.difficulty, { strictDifficulty: false });
      picked.forEach(q => used.add(q));
      out.push(...picked);
    });

    if (out.length < settings.qCount) {
      const rest = TOPICS.flatMap(t => QUESTION_BANK[t]).filter(q => !used.has(q));
      const extra = rankPool(rest).slice(0, settings.qCount - out.length);
      extra.forEach(q => used.add(q));
      out = out.concat(extra);
    }
    return { questions: shuffle(out).slice(0, settings.qCount), requested: settings.qCount, shortfall: 0 };
  }

  /**
   * Weak areas: only ATTEMPTED topics are ranked. Never-attempted topics used to
   * score 0% and win this list, which recommended chapters nobody had opened.
   */
  function buildWeak(settings) {
    const progressed = TOPICS.map(topicProgress);
    const attempted = progressed.filter(p => p.attempts > 0 && p.accuracy != null);
    const untouched = progressed.filter(p => p.attempts === 0);

    let chosen = attempted.filter(p => p.accuracy < 0.85).sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
    let notice = '';

    if (chosen.length === 0 && attempted.length) {
      chosen = attempted.sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
      notice = 'Nothing is under 85% yet — drilling your lowest-accuracy attempted topics.';
    }
    if (chosen.length === 0) {
      chosen = untouched.sort((a, b) => a.total - b.total).slice(0, 3);
      notice = 'No answered questions yet, so this run starts with topics you have never opened.';
    }
    if (chosen.length === 0) return { questions: [], requested: settings.qCount, shortfall: 0, notice: 'No questions available.' };

    const alloc = distribute(settings.qCount, chosen.map(p => p.total));
    let out = [];
    chosen.forEach((p, i) => {
      out = out.concat(pickQuestions(p.topic, alloc[i], settings.difficulty, { strictDifficulty: false }));
    });
    out = shuffle(out).slice(0, settings.qCount);
    return { questions: out, requested: settings.qCount, shortfall: Math.max(0, settings.qCount - out.length), notice };
  }

  function buildTopic(settings, selectedTopics) {
    const topics = selectedTopics.length ? selectedTopics : TOPICS;
    const alloc = distribute(settings.qCount, topics.map(t => QUESTION_BANK[t].length));
    let out = [];
    topics.forEach((topic, i) => {
      out = out.concat(pickQuestions(topic, alloc[i], settings.difficulty, { strictDifficulty: true }));
    });
    return { questions: shuffle(out).slice(0, settings.qCount), requested: settings.qCount, shortfall: 0 };
  }

  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  return {
    TOPICS, ID_OF, META_OF, TOPIC_BY_NAME, TOS_CONFIG,
    validateBank, hash32, bindStats, statFor, topicProgress,
    rankPool, pickQuestions, distribute, sectionAllocation,
    buildExam, buildTrial, buildWeak, buildTopic, shuffle
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QUIZ_ENGINE;
