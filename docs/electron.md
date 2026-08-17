# Electron notes

## Dev-mode security warnings

In development Electron relaxes `webSecurity` and CSP so Vite HMR and worklets load. Those warnings are expected and do not appear in packaged builds.

## Auto-update

`electron-updater` compares **semver**. The installed app only sees an update if GitHub has a **higher** version on the matching channel:

- Stable builds look at normal GitHub releases
- `BETA=true` builds look at pre-releases

A release must include the platform artifacts **and** the updater metadata (`latest-mac.yml`, `latest.yml`, …). Publish with `GH_TOKEN` set:

```bash
export GH_TOKEN=your_token
npm run electron:publish          # stable
npm run electron:publish:beta     # pre-release
```

If an installed build does not find an update, check DevTools for `[Auto-updater]` logs: current version, channel, and whether `latest-*.yml` exists on the release.

Beta distribution and expiration: [beta-testing.md](beta-testing.md).
