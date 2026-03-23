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
```

Optional flags:

- `--backend napi|wasm` (default: `napi`)
- `--time-ms <number>` (default: `1000`)
- `--warmup-ms <number>` (default: `250`)

Examples:

```bash
pnpm bench -- --backend napi
pnpm bench -- --backend wasm --time-ms 2000 --warmup-ms 500
```

## What is measured

- Gowe encode/decode for a single record
- Gowe encode/decode for a 256-record batch
- Gowe session patch encode (`encodePatch`)
- JSON stringify/parse baseline for a comparable payload
- Encoded payload size comparison (`gowe` vs JSON)
- Pretty CLI tables for size and throughput output (`cli-table3`)
