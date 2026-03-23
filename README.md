# Gowe Benchmark

TypeScript benchmark harness for `gowe` (`gowe-js` local package).

## Setup

```bash
pnpm install
```

`gowe` is consumed from `../gowe-js` via a local file dependency. If the native/WASM artifacts are stale, rebuild `gowe-js` first:

```bash
pnpm --dir ../gowe-js build
```

## Run benchmark

```bash
pnpm bench
pnpm bench:max
```

Optional flags:

- `--backend napi|wasm` (default: `napi`)
- `--time-ms <number>` (default: `1000`)
- `--warmup-ms <number>` (default: `250`)
- `--mode full|max` (default: `full`)

Examples:

```bash
pnpm bench -- --backend napi
pnpm bench -- --mode max --backend napi
pnpm bench -- --backend wasm --time-ms 2000 --warmup-ms 500
```

## What is measured

- Gowe encode/decode for a single record
- Gowe encode/decode for a 256-record batch
- Gowe session patch encode (`encodePatch`)
- Raw transport-json fast path (`encodeTransportJson`, `encodeBatchTransportJson`, `decodeToTransportJson`)
- JSON stringify/parse baseline for a comparable payload
- Encoded payload size comparison (`gowe` vs JSON)
- Pretty CLI tables for size and throughput output (`cli-table3`)

## Max speed tips

- Use `--backend napi` on Node.js
- Prefer Node.js `24+` (project baseline)
- Increase run windows for stability (`--time-ms 3000 --warmup-ms 1000`)
- For hot paths, pre-serialize once with transport-json APIs and use raw encode methods
