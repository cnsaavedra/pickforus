# PickForUs Agent Instructions

## Overview
PickForUs (v3) turns a 60-second anonymous group chat into a ranked, veto-aware group decision using schema-constrained local Ollama (`qwen3.5:9b`) with a deterministic negation and spam-dedup fallback engine.

## Commands
- Install: `npm install`
- Check (Biome + TypeScript): `npm run check`
- Test (Vitest): `npm test`
- Build (Vite client + tsc server): `npm run build`
- Dev server (single port 3000 with Vite HMR + `/ws`): `npm run dev`
- Production launcher: `npm start` or `start-pickforus.cmd`

## Architecture & Conventions
- `src/shared/types.ts`: shared API/WebSocket/decision types (use `.js` relative import specifiers on server for `NodeNext`).
- `src/server/`: Express + `ws` (`noServer: true` on `/ws` only) + `node:sqlite` (`DatabaseSync`) + Ollama/deterministic decision engine (`extractor.ts`).
- `src/client/`: React 19 + Vite SPA (`index.html` entry).
- `tests/`: Vitest unit + integration tests (`tests/extractor.test.ts`, `tests/server.test.ts`).

## Hard Rules
- Never read or commit `.env*` files (except `.env.example`), `data/*.sqlite`, `node_modules/`, or `dist/`.
- Keep `AGENTS.md` as single source of truth (`CLAUDE.md` imports `@AGENTS.md`).
- Preserve `meta/foodexamples/*.png` historical screenshots alongside `docs/media/*`.
