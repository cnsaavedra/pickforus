# PickForUs Agent Instructions

## Overview
PickForUs (v3) preserves the original 2019 white-canvas UI/UX (3 teal menu buttons, top-right boxed countdown, anonymous pill bubbles, centered dashed `Top 3:` overlay) powered primarily by a classical Gazetteer + Fuzzy Damerau-Levenshtein + NegEx Clause Negation + Combined Approval Voting engine (`<2ms`), with local Ollama (`qwen3.5:9b`) strictly as an out-of-dictionary fallback.

## Commands
- Install: `npm install`
- Check (Biome + TypeScript): `npm run check`
- Test (Vitest): `npm test`
- Build (Vite client + tsc server): `npm run build`
- Dev server (single port 3000 with Vite HMR + `/ws`): `npm run dev`
- Production launcher: `npm start` or `start-pickforus.cmd`

## Architecture & Conventions
- `src/shared/types.ts`: shared API/WebSocket/decision types (use `.js` relative import specifiers on server for `NodeNext`).
- `src/server/`: Express + `ws` (`noServer: true` on `/ws` only) + `node:sqlite` (`DatabaseSync`) + classical-first / Ollama-fallback engine (`extractor.ts`).
- `src/client/`: React 19 + Vite SPA (`index.html` entry) supporting `/`, `/food`, `/destination`, `/pickforusplease`, and `/room/:code`.
- `tests/`: Vitest unit + integration tests (`tests/extractor.test.ts`, `tests/server.test.ts`).

## Hard Rules
- Never read or commit `.env*` files (except `.env.example`), `data/*.sqlite`, `node_modules/`, or `dist/`.
- Keep `AGENTS.md` as single source of truth (`CLAUDE.md` imports `@AGENTS.md`).
- Preserve `meta/foodexamples/*.png` historical screenshots alongside `docs/media/*`.
