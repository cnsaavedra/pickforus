# PickForUs — Research & Engineering Methods

This document details the behavioral premise, pre-LLM failure modes, neuro-symbolic extraction design, and counterfactual verification framework behind **PickForUs (2018–2026)**.

---

## 1. The 2018–2019 Behavioral & NLU Thesis

Most group-decision apps ask users to act like product managers: create a poll, type options, wait for votes, and break ties manually. PickForUs (originally prototyped in October 2018 – May 2019 on [`v1-2019-archive`](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive)) started from a different behavioral hypothesis:

1. **Time-boxed anonymity breaks politeness deadlock.** Giving friends 60 seconds behind anonymous aliases extracts candid impulses before anyone defaults to *"idk, whatever you want."*
2. **Free-form chat captures constraints polls miss.** Real people do not type canonical database keys. They type compound, noisy thoughts:
   - *"idk honestly whatever you guys want"* (filler / indecisiveness)
   - *"please I don't want burger again, had it yesterday"* (explicit negation + temporal context)
   - *"kinda craving ramen or pho"* (disjunction + short 3-letter food noun)
   - *"ramen ramen ramen!!"* (single-speaker repetition / spam)
   - *"down for ramen or tacos, just no sushi"* (positive candidates + trailing veto)

In 2019, there were no accessible local instruction-following LLMs to turn messy chat into structured JSON. Attempting to approximate that capability with basic string operations exposed clear structural boundaries.

---

## 2. Post-Mortem of Pre-LLM & Early Prototype Gaps

Inspecting the preserved 2019 codebase ([`index.js`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/index.js) and [`public/food.html`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/public/food.html)) reveals why simple heuristics broke on real group chat:

| Category | 2019 Root Cause | Observed Failure | 2026 v3 Resolution |
| :--- | :--- | :--- | :--- |
| **Tokenization** | `msg.split(" ")` with `length <= 3` filter | Rejected valid foods (`pho`, `bbq`, `pie`, `sub`, `tea`) while accepting filler (`anything`, `starving`). | Word-boundary lexicon (`\b...\b` sorted longest-first) + open-vocab trigger phrases + explicit stopword set. |
| **Negation Polarity** | No negation parser despite README design | `"I don't want burger"` inserted `"dont"` and `"burger"` as positive food votes. | Contrastive clause splitting + `NEGATION_PATTERNS` routing negated mentions to `vetoed[]`. |
| **Spam Resistance** | Raw MongoDB `$sum: 1` across `messages` | One user repeating a word dominated the Top 3 tally (`top3Arrays` only set a boolean after ranking). | Per-`(participantId, candidate)` deduplication: max `1` positive supporter vote per person, raw `mentions` tracked separately. |
| **Session & Timer Lifecycle** | Global `var timer = 60` + `setInterval` per socket; `db.close()` inside `/get-data` and `disconnect`; global `top3[]` arrays. | Multiple overlapping countdowns, stale votes leaking across sessions, and MongoDB crashing after round 1. | Per-room timer map + single-flight `1 -> 0` lock + `node:sqlite` scoped by `(room_code, round_number)`. |
| **Action Link** | `elem.href += document.getElementById("topFood").id` | Generated `https://www.google.com/search?q=topFood` instead of the winning restaurant/cuisine. | URL-encoded `mapsUrl` derived from `verdict.winner` and `mode`. |
| **Transport Framing** | Mid-way React/socket rewrites mixing incompatible socket clients/servers or serving raw `.js` source. | Unhandled WebSocket connections or broken round synchronization. | Single-port Express + `ws` (`noServer: true` on `/ws` only) + Vite middleware / static SPA fallback. |

---

## 3. 2026 Hybrid Neuro-Symbolic + Local LLM Architecture

PickForUs v3 does **not** rely on an unguarded LLM prompt alone, nor on brittle word splitting alone. It uses a **two-layer hybrid architecture** in [`src/server/extractor.ts`](../src/server/extractor.ts):

### Layer A — Deterministic Clause & Polarity Engine (`extractDeterministic`)

1. **Clause Segmentation (`splitIntoClauses`):**
   Splits each message on punctuation (`, ; . ! ? \n`) and contrastive transitions (`but`, `though`, `except`, `instead of`) while keeping compound negation phrases (`anything but`, `everything except`) intact inside their clause.
2. **Negation Detection (`isNegatedClause`):**
   Evaluates each clause independently against negation cues (`don't want`, `do not want`, `anything but`, `except`, `instead of`, `no `, `not `, `skip`, `hate`, `tired of`, `sick of`, `had ... yesterday`, `veto`, `never`, `can't do`). Thus `"I don't want burger, maybe pho"` routes `Burgers` to `vetoed[]` while counting `+1` for `Pho`.
3. **Word-Boundary Lexicon + Open-Vocab Extraction:**
   - Lexicon entries are matched longest-first with `\b...\b` boundaries (`"steak"` never triggers `"tea"`, while `"pho"`, `"bbq"`, `"pie"`, `"sub"`, `"dave & busters"` all match cleanly).
   - Explicit intent triggers (`craving X`, `down for X`, `how about X`, `let's do X`, `go to X`, `want X`) extract unseen cuisines or places (`"tapas"`) after stripping stopwords.
4. **Per-Participant Identity Deduplication:**
   Maintains `positiveVoters: Set<string>` and `vetoVoters: Set<string>` keyed by `participantId`. Even if one participant sends `"ramen ramen ramen!!"` across multiple messages, `supporters` stays `1` while `mentions` increments to track enthusiasm and triggers `duplicateDetected = true`.
5. **Tie-Breaking & Total-Veto Recovery:**
   In `surprise` mode, when all chat is filler (`"idk whatever"`), or when every mentioned option was vetoed, PickForUs selects the first curated crowd-pleaser not present in `vetoed` so the group never ends in a stalemate.

### Layer B — Schema-Constrained Local LLM (`extractWithOllama`)

When `PICKFORUS_LLM_MODE` is `auto` (default) or `ollama`, [`extractWithOllama`](../src/server/extractor.ts) sends the anonymized `[Alias (participantId)]: message` transcript to `POST /api/chat` on local Ollama (`qwen3.5:9b`) with:

- `stream: false` and `think: false` (eliminating hidden reasoning-token latency in structured JSON extraction),
- `format: OLLAMA_JSON_SCHEMA` constraining output to `{ winner, summary, candidates[], vetoed[] }`,
- A `25000ms` timeout (accommodating observed cold VRAM load of `~8.3s` + `~3.4s` generation, while warm calls complete in `~3–4s`).

**Symbolic Post-Validation Invariant:**
Before any LLM response becomes a `DecisionVerdict`, `extractWithOllama` runs three deterministic guardrails:
1. Merges deterministic vetoes (`deterministic.vetoed`) with LLM-discovered vetoes (`mergedVetoMap`).
2. Filters out any candidate or proposed `winner` present in the merged `vetoedSet` or `STOPWORDS`, falling back to un-vetoed candidates or `pickCrowdPleaser`.
3. Preserves accurate deterministic `mentions` and `duplicateDetected` flags, then constructs a canonical `mapsUrl`.

If Ollama is unreachable, times out, or returns invalid JSON, `extractWithOllama` falls back silently in `< 5 ms` to `extractDeterministic`.

---

## 4. Realtime Isolation & Single-Flight State Machine

In [`src/server/app.ts`](../src/server/app.ts):

- **Single-port HTTP + WebSocket + Vite:** `WebSocketServer({ noServer: true })` inspects `upgrade` paths and handles `/ws*` exclusively, allowing Vite HMR (`/__vite_hmr`) in dev and static serving in `--prod` on port `3000`.
- **Single-Flight Decision Locking (`inFlightDecisions` + `inFlightTokens`):** Both the `1 -> 0` countdown transition and `POST /api/rooms/:code/finish` converge on `finalizeRoom`. Concurrent `/finish` requests share one promise, and a per-execution `Symbol` token prevents an aborted Round 1 flight from clearing Round 2 state after `/reset`.
- **Zero-Config Persistence (`node:sqlite`):** `PickForUsStore` in [`src/server/db.ts`](../src/server/db.ts) uses Node 22's built-in `DatabaseSync` (`WAL` mode on disk, `:memory:` in tests), isolating chat and verdicts per `(room_code, round_number)`.

---

## 5. Counterfactual Verification Matrix

All behaviors are covered by 13 automated tests ([`tests/extractor.test.ts`](../tests/extractor.test.ts) and [`tests/server.test.ts`](../tests/server.test.ts)) plus live headless Chromium + Ollama `qwen3.5:9b` runs:

1. **Domain Complement:** Filler-only chat yields zero hallucinated food nouns and selects a clean crowd-pleaser; short 2–3 letter foods (`pho`, `bbq`, `pie`, `sub`, `tea`) match without substring collisions (`steak` != `tea`).
2. **Sign & Direction Symmetry:** `"I want burger"` votes `+1` for `Burgers`; `"I don't want burger, maybe pho"` vetoes `Burgers` and crowns `Pho` with `mapsUrl` encoding `Pho`.
3. **Edge vs Level & Round Isolation:** Timer hitting `0` across 3 connected WebSocket clients executes `decideRoom` once (`toHaveBeenCalledTimes(1)`); WebSocket disconnects leave SQLite open; `POST /api/rooms/:code/reset` advances to Round 2 with zero leaked Round 1 votes.
4. **Spam Invariance & Adversarial LLM Mock:** 1 participant repeating `"burger"` 5 times (`supporters: 1, mentions: 5`) loses to 2 participants voting `"ramen"` once each (`supporters: 2`); a mocked LLM proposing a vetoed `winner` (`"Burgers"`) is overridden by the symbolic veto filter to elect `"Pho"`.
