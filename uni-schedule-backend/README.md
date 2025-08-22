uni-schedule-backend

This folder will contain backend/native parts (Tauri + Rust) and any server-side code.
Planned contents to move here:
- src-tauri/ (Tauri Rust code), Cargo.toml, Cargo.lock, build.rs, target/ (optional: may be ignored or kept out of repo)

Refactor steps (local, recommended):
1. Create this folder (already created).
2. Move Tauri/backend files using `git mv` to preserve history (example below).
3. Update any CI or build scripts that reference `src-tauri` at repo root.
4. Build Tauri from the new path and verify the native build.

Example move commands (PowerShell):
```powershell
cd <repo-root>
# move tauri files into backend folder
git mv src-tauri Cargo.toml Cargo.lock build.rs uni-schedule-backend/
```
