# PickForUs — Classical NLP & Social Choice Algorithms

This guide explains the exact non-statistical, deterministic computer science algorithms behind **PickForUs**, why they solve the problems first attempted in 2018–2019, and how each stage maps directly to the modules in [`src/algorithms/`](../src/algorithms/).

---

## 1. The 2019 Behavioral Hypothesis & Algorithmic Gap

Most group-decision apps force friends into rigid polls before anyone agrees on options. PickForUs (first built in October 2018 – May 2019 on [`v1-2019-archive`](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive)) tested a simpler behavioral rule:

1. **Time-boxed anonymity breaks politeness deadlock.** Giving friends 60 seconds behind anonymous grey pills captures honest impulses before everyone replies *"idk, whatever you want."*
2. **Free-form chat carries constraints simple polls lose.** Real messages contain filler chatter, typos, exclusions, and enthusiastic repeats:
   - `"idk honestly whatever you guys want"` -> neutral abstention (`0`)
   - `"please I don't want burger again, had it yesterday"` -> hard exclusion (`-1`)
   - `"kinda craving ramen or pho"` -> multiple approvals (`+1` each)
   - `"ramen ramen ramen!!"` -> single-voter cap (`+1` max approval, flagged duplicate)
   - `"down for ramen or tacos, just no sushi"` -> `+1` on Ramen and Tacos, `-1` on Sushi

In 2019, [`index.js`](https://github.com/cnsaavedra/pickforus/blob/v1-2019-archive/index.js) split every sentence on spaces (`msg.split(" ")`), dropped words `<= 3` characters (`pho`, `bbq`, `pie`, `sub`), skipped only four stopwords (`want`, `some`, `have`, `test`), and counted words directly in MongoDB. That meant `"I don't want burger"` voted **for** `burger`.

---

## 2. The 4-Stage Deterministic Pipeline (`src/algorithms/`)

Every round executes cleanly in `< 2 ms` across four modular stages in [`src/algorithms/pipeline.ts`](../src/algorithms/pipeline.ts):

```text
Raw Message -> [1. NegEx Clause Split] -> [2. Gazetteer + Edit Distance <= 1] -> [3. Polarity] -> [4. Combined Approval Voting]
```

### Stage 1 — NegEx Clause Segmentation & Polarity (`src/algorithms/negation.ts`)

Inspired by **NegEx** (Chapman et al., 2001), negation cues must be scoped to their clause rather than the whole message:

1. **Punctuation split:** Splits at `, ; . ! ? \n`.
2. **Contrastive conjunction split:** Splits at `but`, `though`, `however`, `except`, `instead of`, `other than`, `rather than` (while keeping `anything but` and `everything except` inside their negation clause).
3. **Unpunctuated inline pivot split:**
   - Trailing negation without a comma: `"ramen sounds good no sushi"` -> `["ramen sounds good", "no sushi"]`
   - Negation followed by positive proposal: `"no burger maybe pho"` -> `["no burger", "maybe pho"]`
4. **Scope test (`isNegatedClause`):** Each clause is matched against cues (`don't want`, `do not want`, `anything but`, `except`, `instead of`, `no`, `not`, `skip`, `hate`, `tired of`, `sick of`, `had ... yesterday`, `veto`, `never`, `can't do`).

### Stage 2 — Word-Boundary Gazetteer & Open-Phrase Grammar (`src/algorithms/gazetteer.ts`)

Instead of naive `split(" ")` filtering `word.length > 3`:

1. **Hyphen normalization:** `"bubble-tea"` and `"rice-bowls"` become `"bubble tea"` and `"rice bowls"`.
2. **Longest-first `\b...\b` matching:** Multi-word entries (`fried chicken`, `dave & busters`, `mini golf`, `bubble tea`) match before shorter terms (`tea`, `bar`, `pie`). Word boundaries guarantee `"pho"`, `"bbq"`, `"pie"`, `"sub"`, and `"tea"` match while `"steak"` never triggers `"tea"`.
3. **Preference grammar frames (`extractOpenPhraseCandidates`):** Unlisted foods or places inside frames such as `"craving <X>"`, `"down for <X>"`, `"feel like <X>"`, `"how about <X>"`, `"let's do <X>"` are captured after stripping filler stopwords.

### Stage 3 — Damerau-Levenshtein Edit Distance `<= 1` (`src/algorithms/editDistance.ts`)

Real-time chat under a 60-second clock creates typos (`"spagetti"`, `"ramne"`, `"burgr"`). **Optimal String Alignment (restricted Damerau-Levenshtein)** counts a single insertion, deletion, substitution, or adjacent character transposition as edit distance `1`:

| Input Word | Target Gazetteer Term | Edit Type | Distance |
| :--- | :--- | :--- | :---: |
| `spagetti` | `spaghetti` | 1 deletion (`h`) | `1` |
| `ramne` | `ramen` | 1 adjacent transposition (`e` ↔ `n`) | `1` |
| `burgr` | `burger` | 1 deletion (`e`) | `1` |
| `pasta` | `pizza` | 2 substitutions | `2` (rejected) |

To prevent short English words (`"who"`, `"free"`, `"part"`) from false-matching short foods (`pho`, `pie`, `park`), fuzzy matching only runs on non-stopword tokens of length `>= 5` against `>= 5`-letter lexicon entries, using an `O(min(|a|, |b|))` fast path (`damerauLevenshteinAtMostOne`) with zero matrix allocations.

### Stage 4 — Combined Approval Voting with Veto (`src/algorithms/approvalVoting.ts`)

In social choice theory, **Combined Approval Voting** (Brams & Fishburn 1978; Felsenthal 1989) lets every participant submit a ternary ballot $\{-1, 0, +1\}$ per option:

- **Approve (`+1`):** Mentioning `"spaghetti or fries"` approves both options so flexible voters do not split votes.
- **Abstain (`0`):** Filler such as `"idk whatever"` casts zero votes across all candidates.
- **Idempotent Spam Cap:** Positive votes per candidate are stored in `Set<participantId>`. Repeating `"ramen ramen ramen!!"` across 1 or 5 messages keeps `supporters = 1` for that friend while incrementing `mentions` and setting `"You have duplicates, but we fixed that for you :)"`.
- **Hard Veto (`-1`):** Any option with `vetoedByCount > 0` is placed in `vetoed[]` and excluded before ranking `Top 3`. (If a participant approves an item early and later vetoes it, `-1` overrides `+1` on their ballot.)
- **Earliest-First-Mention Tie-Breaking:** Candidates rank by:
  1. `supporters DESC` (unique approving participants),
  2. `firstMentionIndex ASC` (whichever tied option entered chat first—ensuring extra spam `mentions` can **never** break a tie in a spammer's favor),
  3. `name ASC` (deterministic alphabetical tie-breaker).

---

## 3. Worked Example: Classic 2019 Demo Chat

Using the messages from `chatscreenfood.png`:

1. **Voters 1 & 2** mention `"spaghetti"` and `"fries"` (`2` approvals each, `0` vetoes).
2. **Spaghetti** appeared in message `0`, **Fries** in message `1` -> **Spaghetti** wins the 2-to-2 tie via `firstMentionIndex ASC` (`0 < 1`).
3. **Voter 3** says `"just want desserts like bubble-tea"` -> hyphen normalization extracts `Bubble Tea` (`1` approval) for `#3`.
4. Anyone typing `"I don't want burger, maybe pho"` gets `-1` on `Burgers` and `+1` on `Pho`, and every step is visible live inside the UI's **Show Algorithm Steps** inspector.

---

## 4. 2019 Bugs Fixed in v3

| Component | 2019 Bug | v3 Engineering Fix |
| :--- | :--- | :--- |
| **Tokenization** | `msg.split(" ")` dropped `length <= 3` (`pho`, `bbq`, `pie`) | Longest-first `\b...\b` gazetteer + fuzzy edit distance `<= 1` |
| **Negation** | Counted `"I don't want burger"` as `+1` vote for `burger` | NegEx clause segmentation + inline polarity splitting |
| **Spam Tie-Break** | Raw count `$sum: 1` let one spammer dominate rankings | Per-voter `Set` (`+1` max) + `firstMentionIndex` tie-break |
| **Timers & State** | Global `var timer = 60` + `db.close()` after 1 round | Per-room timers, `node:sqlite` by `(room_code, round_number)` |
| **Suggestion URL** | `elem.href += "topFood"` linked literally to `"topFood"` | URL-encoded `mapsUrl` from `verdict.winner` and `mode` |

---

## 5. Complexity Summary

For $M$ messages with total length $L$ characters, $|G|$ gazetteer entries, and $C$ extracted candidate options:

- **NegEx Clause Segmentation:** $O(L)$
- **Gazetteer + Damerau-Levenshtein `<= 1`:** $O(L + W \cdot |G_{\ge 5}|)$ where $W$ is unmatched tokens $\ge 5$ chars (typically $< 0.5\text{ ms}$)
- **Combined Approval Tally & Ranking:** $O(M + C \log C)$

Total end-to-end decision time is consistently **`< 2 ms`** with zero external network calls or dependencies.
