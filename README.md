# Undergrain

Desktop granular synthesizer. The GitHub repository is `Topographic-Granulator`; the app ships as **Undergrain**.

TypeScript + Vite UI, Electron shell, Rust/WASM DSP (`granular-core`).

## Prerequisites

- Node.js 20+
- Rust (`rustup`)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) (`cargo install wasm-pack`)

Generated WASM in `src/wasm/` is gitignored. A fresh clone must build it before the app will run.

## Setup

```bash
npm install
npm run build:wasm
```

## Development

```bash
npm run electron:dev:full
```

That starts the Vite server and Electron together. Equivalent two-terminal flow:

```bash
npm run dev
npm run electron:dev:wait
```

Web-only UI (no desktop shell): `npm run dev`.

## Build

```bash
npm run electron:build:mac     # current machine
npm run electron:build:win
npm run electron:build:linux
npm run electron:build:all
```

Packaged apps land in `release/`. Auto-updates use GitHub Releases (`electron-updater`). Beta builds and tester workflow: [docs/beta-testing.md](docs/beta-testing.md). Auto-update debugging: [docs/electron.md](docs/electron.md).

## Layout

| Path | Role |
| --- | --- |
| `src/` | Renderer: UI, audio graph, session, MIDI |
| `granular-core/` | Rust DSP compiled to WASM |
| `electron/` | Main process and preload |
| `public/worklets/` | AudioWorklet processor |
| `build/` | electron-builder icons and macOS entitlements |
