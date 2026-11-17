# PickForUs — Research & Engineering Methods

This document explains the behavioral premise, the exact classical NLP and voting algorithm that PickForUs (2018–2019) was aiming for without LLMs, the concrete prototype bugs fixed in v3, and how local LLM inference now serves strictly as an out-of-dictionary fallback.

---

## 1. The 2018–2019 Behavioral & NLU Thesis

Most group-decision apps ask users to act like product managers: create a poll, type options, wait for votes, and break ties manually. PickForUs (originally prototyped in October 2018 – May 2019 on [`v1-2019-archive`](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive)) started from a different behavioral hypothesis:

1. **Time-boxed anonymity breaks politeness deadlock.** Giving friends 60 seconds behind anonymous gray bubbles extracts candid impulses before anyone defaults to *"idk, whatever you want."*
2. **Free-form chat captures constraints polls miss.** Real people do not type canonical database keys. They type compound, noisy thoughts:
   - *"idk honestly whatever you guys want"* (filler / neutral abstention)
   - *"please I don't want burger again, had it yesterday"* (explicit negation + temporal cue)
   - *"kinda craving ramen or pho"* (disjunction + short 3-letter food noun)
   - *"ramen ramen ramen!!"* (single-speaker repetition / spam)
   - *"down for ramen or tacos, just no sushi"* (multiple positive approvals + trailing veto)

---

## 2. The Closest Classical Algorithm (Zero LLM "Cheating")

Ignoring modern LLMs completely, the exact mathematical system that matches what [`index.js`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/index.js) (`// compare to a dictionary later`) and the 2019 `README.md` were reaching toward is a **two-stage classical NLP + Social Choice algorithm**:

### Stage 1 — Gazetteer Entity Extraction + Damerau-Levenshtein + NegEx Clause Negation

1. **Longest-Phrase Word-Boundary Gazetteer:**
   Instead of splitting on spaces and discarding `word.length <= 3`, chat text is hyphen-normalized (`bubble-tea` -> `bubble tea`) and matched longest-first against a normalized lexicon on `\b...\b` boundaries. This recovers multi-word dishes (`fried chicken`, `dim sum`, `bubble tea`, `rice bowls`, `dave & busters`) and short items (`pho`, `bbq`, `pie`, `sub`, `tea`) without false substring hits (`"steak"` never triggers `"tea"`).
2. **Bounded Typo Tolerance (Optimal String Alignment / Damerau-Levenshtein `<= 1`):**
   On unmatched alphabetic words of length `>= 5` (after filtering stopwords), single-edit typos against `>= 5`-letter lexicon entries are recovered—supporting 1 substitution, 1 insertion/deletion, or 1 adjacent swap (`"spagetti"` -> `Spaghetti`, `"ramne"` -> `Ramen`, `"burgr"` -> `Burgers`) while preventing short English words from matching food names.
3. **NegEx-Style Clause-Scoped Negation (Chapman et al., 2001):**
   Each message is split on punctuation (`, ; . ! ? \n`) and contrastive transitions (`but`, `though`, `except`, `instead of`) while keeping compound exclusions (`anything but`, `everything except`) intact. Each clause is tested independently against negation triggers (`don't want`, `do not want`, `anything but`, `except`, `instead of`, `no `, `not `, `skip`, `hate`, `tired of`, `sick of`, `had ... yesterday`, `veto`, `never`, `can't do`), routing negated entities into `vetoed[]` instead of positive votes.

### Stage 2 — Combined Approval Voting with Veto (`{-1, 0, +1}`)

In social choice theory, **Combined Approval Voting** (Brams & Fishburn 1978; Felsenthal 1989) gives each voter an independent `{-1, 0, +1}` evaluation over every candidate:

- **Approve (`+1`):** Saying `"spaghetti or fries"` approves **both** options so friends who are flexible do not split votes.
- **Abstain (`0`):** Saying `"idk whatever"` or `"anything is fine"` leaves all candidates unaffected.
- **Idempotent Spam Cap (Max `+1` per Speaker):** Positive votes are tracked as `Set<participantId>` union per canonical option. Repeating `"ramen ramen ramen!!"` across 1 or 5 messages keeps `supporters = 1` for that speaker while incrementing `mentions` and flagging `duplicateDetected` (`"You have duplicates, but we fixed that for you :)"`).
- **Hard Veto (`-1`):** Any option with `vetoedByCount > 0` is disqualified from winning or appearing in `Top 3` (falling back to an un-vetoed crowd-pleaser only if *every* mentioned option was vetoed).
- **Deterministic Tie-Breaking:** Ties break by `(supporters DESC, mentions DESC, name ASC)`—or by curated un-vetoed crowd-pleasers when nobody commits (`Pick For Us please`).

---

## 3. Why 2019 Broke on Real Chat (Root-Cause Post-Mortem)

Inspecting [`v1-2019-archive/index.js`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/index.js) and [`public/food.html`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/public/food.html) explains every 2019 bug:

| Category | 2019 Root Cause | Observed Failure | 2026 v3 Resolution |
| :--- | :--- | :--- | :--- |
| **Tokenization** | `msg.split(" ")` with `length <= 3` drop | Rejected `pho`, `bbq`, `pie`, `sub`, while accepting `"anything"` and `"starving"`. | Longest-first `\b...\b` gazetteer + fuzzy Levenshtein (`<= 1`) + explicit stopword set. |
| **Negation Polarity** | No negation parser despite README design | `"I don't want burger"` inserted `"dont"` and `"burger"` as positive votes. | Contrastive clause splitting + `NEGATION_PATTERNS` routing negated clauses to `vetoed[]`. |
| **Spam Resistance** | Raw MongoDB `$sum: 1` across `messages` | One user spamming dominated Top 3 counts. | Per-`(participantId, candidate)` `Set` capping each friend at `1` approval vote. |
| **Session & Timer Lifecycle** | Global `var timer = 60` + `setInterval` per socket; `db.close()` inside `/get-data` and `disconnect`; global `top3[]`. | Overlapping countdowns, leaked session state, and MongoDB crashing after round 1. | Per-room timer map + single-flight `1 -> 0` lock + `node:sqlite` scoped by `(room_code, round_number)`. |
| **Action Link** | `elem.href += document.getElementById("topFood").id` | Generated `https://www.google.com/search?q=topFood` instead of the winning food. | URL-encoded `mapsUrl` derived from `verdict.winner` and `mode`. |

---

## 4. Local LLM Strictly as Out-of-Dictionary Fallback

In `PICKFORUS_LLM_MODE=auto` (default), `decideRoom` runs the classical algorithm (`extractDeterministic`) **first** in `< 2 ms`:

1. If `mode === "surprise"`, `messages.length === 0`, or the classical engine extracted `>= 1` positive candidate (`top3.length > 0`), it returns immediately with **`engineUsed: "rules"`** (zero LLM calls).
2. If chat contains only stopwords or already-vetoed items (no unrecognized substantive words), it also returns deterministically with zero LLM calls.
3. **Only when `top3.length === 0` AND chat contains unrecognized non-stopword terms** (such as unlisted local restaurants or slang like `"pierogi or khachapuri"`) does `decideRoom` call local Ollama (`qwen3.5:9b`, `stream: false`, `think: false`, JSON-schema `format`, `25000ms` timeout).

Even in that fallback path, `extractWithOllama` enforces **symbolic post-validation**: LLM candidates and `winner` are checked against the merged deterministic + LLM `vetoedSet` and `STOPWORDS` so the model can never recommend an excluded item, and offline/timeout errors degrade seamlessly back to `extractDeterministic`.

---

## 5. Realtime Isolation & Counterfactual Verification

- **Single-port HTTP + WebSocket + Vite:** [`src/server/app.ts`](../src/server/app.ts) mounts `WebSocketServer({ noServer: true })` exclusively on `/ws*`, coexisting cleanly with Vite HMR in dev and static assets in `--prod`.
- **Single-Flight Decision Locking (`inFlightDecisions` + `inFlightTokens`):** Both the `1 -> 0` edge and `POST /api/rooms/:code/finish` share one in-flight decision promise, guarded by a per-round `Symbol` token across `/reset`.
- **14 Automated Counterfactual & Integration Tests ([`tests/extractor.test.ts`](../tests/extractor.test.ts), [`tests/server.test.ts`](../tests/server.test.ts)):**
  1. *Domain complement:* filler-only chat yields 0 bogus options; 2–3 char foods (`pho`, `bbq`, `pie`, `sub`, `tea`) + 2019 demo foods (`spaghetti`, `fries`, `bubble-tea`) + edit-distance-1 typos (`spagetti`, `ramne`, `burgr`) resolve with 0 false positives on `"who is free for the part with hungry friends"`.
  2. *Sign & direction symmetry:* `"I want burger"` approves `Burgers`, while `"I don't want burger, maybe pho"` vetoes `Burgers` and crowns `Pho` with valid `mapsUrl`.
  3. *Classical-first routing:* Known dishes return `engineUsed: "rules"` with `0` `fetch` calls; out-of-gazetteer terms (`"pierogi"`, `"khachapuri"`) trigger the Ollama fallback and degrade cleanly when offline.
  4. *Edge vs level & round isolation:* `1 -> 0` across 3 WebSocket clients invokes `decideRoom` once; WebSocket disconnect leaves SQLite open; `/reset` isolates Round 2 cleanly.
