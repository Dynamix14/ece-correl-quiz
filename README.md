# ECE Correl Quiz Trainer

Offline quiz trainer for the **Mapua ECE Correlation exams** (ELECS and EST, 1st Term S.Y. 2026–2027).

- **493 questions across 17 topics**, each with an explanation, a source line, and (for most items) a note on why every wrong option is wrong
- Runs entirely in the browser from files on disk — no server, no build step, no dependencies
- Blueprint "trial exams" that follow the ELECS/EST table of specifications
- Mastery tracking per topic: accuracy, questions seen, weakest areas
- Keyboard-driven, screen-reader labelled, mobile-friendly dark UI

## Files

| File | What it is |
| --- | --- |
| `index.html` | Markup and styles. Open this. |
| `data.js` | The question bank — the only file you edit to add or fix questions. |
| `engine.js` | Question selection, difficulty handling, exam assembly. No DOM, so it is unit-tested. |
| `app.js` | Rendering, progress storage, keyboard shortcuts, study mode. |
| `test/` | `node --test` suites for the bank and the engine. |

All three scripts are classic `<script>` tags on purpose: opening `index.html` straight from disk works, which a module or bundler setup would break.

## Using it

Double-click `index.html`, or use https://dynamix14.github.io/ece-correl-quiz/.

- **By Topic** — pick any topics, set a question count, start. Topic quizzes honour the difficulty filter strictly.
- **Trial Exam (All)** — a mixed run sampled across every topic.
- **ELECS / EST Trial** — fixed blueprint: sections appear in TOS order with their exact item counts. If the chosen difficulty is too thin for a section, it is filled from the other difficulties so the exam still totals its blueprint length (a notice says so).
- **Weak Areas** — drills your lowest-accuracy *attempted* topics. Untouched topics are not treated as 0% and are never recommended before you have answered something.
- **Study Mode** — read the whole bank with answers revealed; filter to hard items, previously missed items, or unseen items.
- **Pace** — optional per-item countdown (45/60/90 s) for exam timing; expiry counts the item as skipped.

**Keys:** `A`–`D` or `1`–`4` to answer, `Enter` to advance, `Esc` to quit. **Skip** records an unanswered item honestly instead of scoring it.

Progress lives in `localStorage` and can be exported to JSON and re-imported on another machine (imports are a union, so re-importing is harmless).

## Development

```sh
npm test        # node --test — bank invariants + engine behaviour
```

The bank tests are the reason several wrong answers no longer ship: they assert that every keyed answer is in range, that the explanation never points at a different option, that per-option notes are aligned with the option they explain, and that no note is pasted in from another question. CI runs them on every push.

### Adding questions

Append to the array for the topic in `data.js`:

```js
{
  q: "…",                          // stem
  options: ["…", "…", "…", "…"],
  answer: 2,                       // index into options
  diff: "easy",                    // easy | medium | hard
  exp: "…",                        // why the keyed answer is right
  why: ["…", "…", "", "…"],        // per-option notes; "" for the keyed option
  src: "Quiz 1 · Topic · Q12",     // provenance
  img: "data:image/png;base64,…"   // optional inline figure
}
```

Run `npm test` afterwards — it will tell you if `why[]` is misaligned or the explanation contradicts the key.

## Data corrections

The bank was audited and repaired in this revision. Items whose explanation contradicted the key, whose options were off by a decade, or whose per-option notes were pasted in from another question were rewritten so the maths in the explanation reproduces the keyed answer. 37 untouched Antenna Theory / Radiowave Propagation / Logic Circuits items carry `Unattributed` as their source because no quiz or lecture trail existed for them.

Questions derive from quizzes and lecture material (Prof. Engr. Herbert V. Villaruel; some items by Engr. John Louis Lagtamada).

## License

Personal study tool. Content reflects lecture material; no claim is made over the underlying exam questions.
