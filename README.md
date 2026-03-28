# Recurram Benchmark

TypeScript benchmark harness for `recurram` (`recurram-js` local package).

## Setup

```bash
pnpm install
```

`recurram` is consumed from `../recurram-js` via a local file dependency. If the native/WASM artifacts are stale, rebuild `recurram-js` first:

```bash
pnpm --dir ../recurram-js build
```

## Run benchmark

```bash
pnpm bench
pnpm bench:msgpack
pnpm bench:max
```

Optional flags:

- `--backend napi|wasm` (default: `napi`)
- `--time-ms <number>` (default: `1000`)
- `--warmup-ms <number>` (default: `250`)
- `--mode full|max` (default: `full`)
- `--recurram-vs-msgpack-only` (hide JSON rows and JSON benchmark tasks)

Examples:

```bash
pnpm bench -- --backend napi
pnpm bench -- --recurram-vs-msgpack-only
pnpm bench -- --mode max --backend napi
pnpm bench -- --backend wasm --time-ms 2000 --warmup-ms 500
```

## What is measured

- Recurram encode/decode for a single record
- Recurram encode/decode for a 256-record batch
- MessagePack encode/decode baselines for single and batched payloads
- Recurram session patch encode (`encodePatch`)
- Raw transport-json fast path (`encodeTransportJson`, `encodeBatchTransportJson`, `decodeToTransportJson`)
- JSON stringify/parse baseline for a comparable payload
- Encoded payload size comparison (`recurram` vs MessagePack vs JSON)
- Pretty CLI tables for size and throughput output (`cli-table3`)

## Max speed tips

- Use `--backend napi` on Node.js
- Prefer Node.js `24+` (project baseline)
- Increase run windows for stability (`--time-ms 3000 --warmup-ms 1000`)
- For hot paths, pre-serialize once with transport-json APIs and use raw encode methods
