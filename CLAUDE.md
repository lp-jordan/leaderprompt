# LeaderPrompt Instructions

These instructions apply to all work within `leaderprompt/` and extend the root workspace instructions.

## Packaging & Version Bump

Whenever packaging a new LeaderPrompt build for distribution (i.e. running `npm run package`):

1. **Bump the version first** in `package.json` (e.g. `1.0.6` → `1.0.7`).
2. Run `npm run build` to rebuild the Vite bundle with the new version.
3. Run `npm run package` to produce the DMG/ZIP in `release/`.

The version bump is required because `LpReleaseService` in LPOS watches `release/latest-mac.yml` for changes. It uses the version field to detect a new release and update `lp-releases/status.json`, which triggers the in-app update banner for LP clients. If the version number doesn't change, LPOS will not surface the update.

**Do not skip the version bump — LPOS will not see the new build without it.**
