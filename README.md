# Unity WebRunner

Electron app for running Unity WebGL builds locally.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run dist:linux
npm run dist:win
```

## Notes

- The Electron main process hosts the dashboard and uploaded Unity build on a local HTTP server.
- Linux and Windows packaging produce unpacked `dir` builds under `release/`.
