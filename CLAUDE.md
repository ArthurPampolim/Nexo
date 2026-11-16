# CLAUDE.md

This file gives Claude Code the repo-specific context it should not have to rediscover.

## Project

- Node.js package.
- Built with: Vite.

## Package manager

- Use `npm` for this workspace. The lockfile is `package-lock.json`.
- Run package scripts with `npm run <script>`.

## Commands

```bash
npm run dev
npm run build
npm test
```

Tests: Vitest (`src/finance.test.js`). No linter or formatter is configured.

## Architecture

- Project: app-financeiro.
- Uses Vite for dev server and bundling.

## Source entry points

- `src/main.js` — init, auth, routing, dashboard, theme, profile; exposes `AppController` for inline handlers.
- `src/screens/*.js` — one module per screen; they reach main.js functions through `app` (`src/app.js`).
- `src/core.js` (shared state/utilities), `src/finance.js` (pure calculations, tested).
- `index.html` — ES module script, loads scripts.

## Runtime assets and packaging

- `dist/` is ignored, so build before launching, testing, or packaging.

## Comment style

- Never place comments on the first two lines of a source file; start with imports or declarations.
- Prefer concise section headings such as `// ── Constants ──` or a three-line banner for major sections so files remain easy to scan.
- Use JSDoc blocks only when an API, intent, edge case, or constraint needs explanation; do not restate the code.

## UI conventions

- Every menu, tab bar, or segmented selector uses the sliding pill: markup `.seg-control` > `.seg-pill` + `.seg-btn` (active one has `.active`); JS toggles `.active` and calls `moveSegPill(containerId)` (call `moveSegPill(id, false)` when the view is first shown and on resize). Swapped content gets `.tab-pane-enter`.
- The sidebar uses its own vertical variant, `moveTabIndicator`.
- Destructive actions use `confirmDialog({...})` instead of `confirm()`.

## Caveats

- No linter detected — no `lint` script, no ESLint config.
- No formatter detected — no Prettier config or format script.

## Boundaries

- Prefer existing local patterns and helper APIs before adding new abstractions.
- Keep generated, packaged, and runtime asset boundaries intact; do not move files across host/webview ownership without updating build and packaging config.

## Claude Code workflow

- For broad or uncertain changes, explore first and propose a plan before editing.
- Prefer focused verification commands while iterating, then run the full gate before finishing.
- Keep this file concise; move shared agent instructions to `AGENTS.md` if that file is added later.
