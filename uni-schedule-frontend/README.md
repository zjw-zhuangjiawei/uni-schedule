uni-schedule-frontend

This folder will contain the frontend app (React + Vite + TypeScript).
Planned contents to move here:
- package.json, bun.lock, tsconfig.json, vite.config.ts, src/ (React app)
- vitest.setup.ts, test-env.d.ts, vite-env.d.ts, README.md (frontend docs)

Refactor steps (local, recommended):
1. Create this folder (already created).
2. Move frontend files: use `git mv` to preserve history (example commands below).
3. Update paths in `vite.config.ts`, any root-level imports, and update workspace scripts.
4. Run `npm/yarn/bun install` inside this folder and `npm run dev` to verify.

Example move commands (PowerShell):
```powershell
cd <repo-root>
# move files into frontend folder while preserving git history
git mv package.json bun.lock tsconfig.json tsconfig.node.json vite.config.ts vitest.setup.ts README.md index.html src uni-schedule-frontend/
```
