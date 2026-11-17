# PickForUs

> **A 60-second anonymous group-chat decision app — preserving the minimalist 2019 UI/UX and implementing the exact classical NLP and Social Choice algorithms it was built for: Gazetteer Phrase Extraction, Damerau-Levenshtein Typo Recovery, NegEx Clause Negation, and Combined Approval Voting.**

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![Node >= 22](https://img.shields.io/badge/Node-%3E%3D22-339933.svg)](package.json)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](tsconfig.json)
[![Algorithms: NegEx + Approval Voting](https://img.shields.io/badge/Algorithms-NegEx%20%2B%20Approval%20Voting-17a2b8.svg)](docs/ALGORITHMS.md)

[Live Walkthrough](#live-walkthrough) · [Same 2019 UI/UX, Improved](#same-2019-uiux-improved) · [Algorithms & Learning Architecture](#algorithms--learning-architecture) · [Quickstart](#quickstart) · [Algorithm Deep Dive](docs/ALGORITHMS.md) · [2019 Archive Branch](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive)

---

Hanging out with friends, everyone is starving, and every message in the group chat is *"idk, whatever you guys want"*?

**PickForUs** turns a **60-second anonymous blitz chat** into a clear group verdict. Instead of building a formal poll first, everyone drops honest cravings and hard vetoes before politeness stalls the chat. At `0`, PickForUs strips filler words, enforces exclusions (*"please I don't want burger again"*), collapses repeat spam (*"ramen ramen ramen!!"*), breaks ties fairly, and renders an inspectable step-by-step algorithm trace.

---

## Live Walkthrough

![PickForUs live 60-second walkthrough preserving the classic 2019 UI/UX](./docs/media/pickforus-demo.gif)

| 1. Main Menu (`Picking Food` / `Destination` / `Pick For Us`) | 2. Anonymous Pill Feed + Boxed Timer | 3. Centered Dashed `Top 3:` Overlay + Trace |
| :---: | :---: | :---: |
| ![PickForUs Main Menu](./docs/media/v3-lobby.png) | ![PickForUs Live Chat](./docs/media/v3-live-blitz.png) | ![PickForUs Dashed Verdict Overlay](./docs/media/v3-verdict.png) |
| Classic white canvas and three `#17a2b8` teal buttons that start a 60s room immediately. | Top-right black-bordered integer timer, sky-blue server pills, grey anonymous bubbles, green `Send` bar. | Centered black-dashed `Top 3:` box honoring `"don't want"` exclusions, spam caps, and **Show Algorithm Steps**. |

---

## Same 2019 UI/UX, Improved

Originally prototyped in **October 2018 – May 2019** ([`v1-2019-archive`](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive)), PickForUs explored extracting consensus directly from unstructured group chat. The current codebase keeps that exact minimalist 2019 interface while replacing every brittle prototype hack with clean, verifiable algorithms:

| Screen / Layer | 2019 Original (`v1-2019-archive`) | Improved Codebase (`master`) |
| :--- | :--- | :--- |
| **Main Menu** | ![2019 Menu](./meta/foodexamples/mainmenu.png) | Preserves the centered white canvas + 3 `#17a2b8` teal buttons; adds 4-letter room join and lexicon health status. |
| **Chat & Timer** | ![2019 Chat](./meta/foodexamples/chatscreenfood.png) | Preserves the top-right black-bordered integer clock, light-blue server pills, grey anonymous bubbles, and green `Send` bar; isolates timer + chat per room (`?room=CODE`). |
| **Results Overlay** | ![2019 Results](./meta/foodexamples/suggestionfoodv2.png) | Preserves the centered black-dashed `Top 3:` box, `"You have duplicates, but we fixed that for you :)"`, and teal suggestion button; fixes `"topFood"` URL bug and adds **Show Algorithm Steps**. |
| **Decision Engine** | Space-splitter (`length > 3`), counted `"don't want burger"` FOR burger, leaked `top3[]`. | Modular **`src/algorithms/`** pipeline (`<2ms`): **Gazetteer + Damerau-Levenshtein `<= 1` + NegEx Negation + Combined Approval Voting (`-1, 0, +1`)**. |
| **Persistence** | External `mongodb://localhost:27017` closed after `/get-data`. | Zero-config built-in Node SQLite (`node:sqlite` `DatabaseSync`) scoped per `(room_code, round_number)`. |

---

## Algorithms & Learning Architecture

Each stage of the decision engine lives in its own focused, readable module under [`src/algorithms/`](src/algorithms/):

```mermaid
flowchart LR
    Chat["Anonymous Room Chat"] --> NegEx["1. NegEx Clause Segmentation (negation.ts)"]
    NegEx --> Gaz["2. Gazetteer + Open Grammar (gazetteer.ts)"]
    Gaz --> Edit["3. Damerau-Levenshtein <= 1 (editDistance.ts)"]
    NegEx --> CAV["4. Combined Approval Voting -1 / 0 / +1 (approvalVoting.ts)"]
    Edit --> CAV
    CAV --> Verdict["Dashed Top 3 Overlay + Algorithm Trace"]
```

- **[`src/algorithms/negation.ts`](src/algorithms/negation.ts) — NegEx Clause-Scope Negation (Chapman et al., 2001):** Splits punctuated sentences, contrastive conjunctions (`but`, `except`, `instead of`), and unpunctuated inline polarity shifts (`"ramen sounds good no sushi"`, `"no burger maybe pho"`) so vetoes only affect their own clause.
- **[`src/algorithms/gazetteer.ts`](src/algorithms/gazetteer.ts) — Longest-Phrase Word-Boundary Gazetteer:** Matches multi-word (`bubble-tea`, `dave & busters`) and short entities (`pho`, `bbq`, `pie`, `sub`, `tea`) without false substring hits (`"steak"` never triggers `"tea"`), plus open preference triggers (`craving X`, `feel like X`).
- **[`src/algorithms/editDistance.ts`](src/algorithms/editDistance.ts) — Damerau-Levenshtein (`<= 1`) Typo Recovery:** Recovers single-edit typos and adjacent character transpositions (`"spagetti"` → `Spaghetti`, `"ramne"` → `Ramen`, `"burgr"` → `Burgers`) on `>= 5`-letter words in `O(min(|a|, |b|))` time.
- **[`src/algorithms/approvalVoting.ts`](src/algorithms/approvalVoting.ts) — Combined Approval Voting (`{-1, 0, +1}`, Brams & Fishburn 1978):** Grants flexible preferences `+1` on multiple options without vote splitting, keeps filler at `0`, caps per-person spam at `+1`, excludes `-1` vetoes, and breaks ties by earliest first mention so spamming never wins a tie.
- **[`src/algorithms/pipeline.ts`](src/algorithms/pipeline.ts) — Explainable Pipeline & Trace:** Captures per-clause polarity, typo fixes, anonymized voter ballots (`Voter #1..#N`), and timing (`durationMs`), inspectable right inside the UI via **Show Algorithm Steps**.

Read the complete worked examples and complexity analysis in [**`docs/ALGORITHMS.md`**](docs/ALGORITHMS.md).

---

## Quickstart

PickForUs runs **out of the box** with zero external database or `.env` setup required (Node.js `>= 22` provides built-in `node:sqlite`).

### 1. Run Locally (Development or Production)

```bash
npm install
npm run dev
```

Open **`http://localhost:3000`**, click **Picking Food**, click **Load Demo Chat** (or open a second browser tab with the copied invite link), and click **Finish Now** to see the verdict and click **Show Algorithm Steps**.

For production build & launch:

```bash
npm run build
npm start
```

On Windows, double-click **`start-pickforus.cmd`** (includes an automatic `PATH` guard if user environment variables exceed `cmd.exe`'s 8191-character limit).

### 2. Optional Environment Overrides

Copy `.env.example` to `.env` if you want to customize the port or database path:

```env
PORT=3000
PICKFORUS_DB_PATH=./data/pickforus.sqlite
```

### 3. Verify Everything

```bash
npm run check   # Biome lint/format + strict TypeScript (noUncheckedIndexedAccess)
npm test        # Vitest algorithm unit tests + WebSocket/SQLite integration suite
npm run build   # Vite client bundle + NodeNext server compile
```

---

## Repository History & License

- **`master` (current):** Clean TypeScript / React 19 / `node:sqlite` implementation preserving the 2019 UI/UX on top of the original 2018–2019 commit graph.
- **[`v1-2019-archive`](https://github.com/cnsaavedra/pickforus/tree/v1-2019-archive):** Frozen snapshot of the May 2019 prototype (`88641c5`) preserved for historical reference.

Licensed under the [MIT License](LICENSE).
