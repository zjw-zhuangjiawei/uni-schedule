# Uni Schedule

A simple tool to manage and visualize schedules.

## License

MIT

## Repository layout after refactor

This repository has been refactored into two folders:

- `uni-schedule-frontend` — the Vite + React frontend
- `uni-schedule-backend` — the Tauri (Rust) backend

To move files while preserving git history, run the example commands below from the repo root in PowerShell.

Example move commands (PowerShell):

```powershell
cd <repo-root>
# Move frontend files
git mv package.json bun.lock tsconfig.json tsconfig.node.json vite.config.ts vitest.setup.ts index.html src uni-schedule-frontend/

# Move tauri/backend files
git mv src-tauri Cargo.toml Cargo.lock build.rs uni-schedule-backend/

# Commit
git commit -m "Refactor: split frontend and backend into separate folders"
```

After moving:

- Update CI/workflows that reference root paths.
- In `src-tauri/tauri.conf.json`, `build.frontendDist` should point to the frontend dist folder (already adjusted in this repo).

