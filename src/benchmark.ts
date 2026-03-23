import { Bench } from "tinybench";
import Table from "cli-table3";
import {
  createSessionEncoder,
  decode,
  decodeToTransportJson,
  encode,
  encodeBatch,
  encodeBatchTransportJson,
  encodeTransportJson,
  init,
  toTransportJson,
  toTransportJsonBatch,
  type GoweValue,
} from "gowe";

type BackendKind = "napi" | "wasm";
type BenchMode = "full" | "max";

interface CliOptions {
  backend: BackendKind;
  timeMs: number;
  warmupMs: number;
  mode: BenchMode;
}

function parseCliOptions(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    backend: "napi",
    timeMs: 1000,
    warmupMs: 250,
    mode: "full",
  };

  const options = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--backend" && argv[i + 1]) {
      const backend = argv[i + 1];
      if (backend === "napi" || backend === "wasm") {
        options.backend = backend;
      }
      i += 1;
      continue;
    }

    if (arg === "--time-ms" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeMs = parsed;
      }
      i += 1;
      continue;
    }

    if (arg === "--warmup-ms" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.warmupMs = parsed;
      }
      i += 1;
      continue;
    }

    if (arg === "--mode" && argv[i + 1]) {
      const mode = argv[i + 1];
      if (mode === "full" || mode === "max") {
        options.mode = mode;
      }
      i += 1;
    }
  }

  return options;
}

function formatOps(ops: number): string {
  return Math.round(ops).toLocaleString();
}

function formatNsPerOp(ops: number): string {
  if (ops <= 0) {
    return "n/a";
  }

  const ns = 1e9 / ops;
  return Math.round(ns).toLocaleString();
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString();
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatRelativeSpeed(hz: number, fastestHz: number): string {
  if (hz <= 0 || fastestHz <= 0) {
    return "n/a";
  }

  return `${(hz / fastestHz).toFixed(2)}x`;
}

function toJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await init({ prefer: options.backend });

  const singleRecord: GoweValue = {
    id: 1234,
    userId: 987654,
    name: "alice",
    active: true,
    score: 98.5,
    tags: ["edge", "premium", "ap-northeast-1"],
    profile: {
      country: "JP",
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
    },
  };

  const singleRecordJson = {
    id: 1234,
    userId: 987654,
    name: "alice",
    active: true,
    score: 98.5,
    tags: ["edge", "premium", "ap-northeast-1"],
    profile: {
      country: "JP",
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
    },
  };

  const batchRecords: GoweValue[] = Array.from({ length: 256 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      userId: 100000 + id,
      active: id % 2 === 0,
      tier: id % 3 === 0 ? "gold" : "standard",
      country: id % 5 === 0 ? "US" : "JP",
      usage: {
        requests: 5000 + id,
        errors: id % 17,
      },
    };
  });

  const batchRecordsJson = batchRecords as unknown[];

  const goweEncodedSingle = encode(singleRecord);
  const goweEncodedBatch = encodeBatch(batchRecords);
  const goweEncodedSingles = batchRecords.map((value) => encode(value));
  const goweTransportSingle = toTransportJson(singleRecord);
  const goweTransportBatch = toTransportJsonBatch(batchRecords);
  const goweEncodedSingleRaw = encodeTransportJson(goweTransportSingle);
  const jsonEncodedSingle = toJsonBytes(singleRecordJson);
  const jsonEncodedBatch = toJsonBytes(batchRecordsJson);
  const jsonSingleText = new TextDecoder().decode(jsonEncodedSingle);
  const jsonBatchText = new TextDecoder().decode(jsonEncodedBatch);

  const sessionEncoder = createSessionEncoder({
    enableStatePatch: true,
    enableTemplateBatch: true,
  });
  sessionEncoder.encode(singleRecord);

  const rawSessionEncoder = createSessionEncoder({
    enableStatePatch: true,
    enableTemplateBatch: true,
  });
  rawSessionEncoder.encodeTransportJson(goweTransportSingle);

  const patchA: GoweValue = {
    ...singleRecord,
    score: 99.1,
    profile: {
      country: "JP",
      locale: "ja-JP",
      timeZone: "Asia/Seoul",
    },
  };

  const patchB: GoweValue = {
    ...singleRecord,
    score: 98.1,
    profile: {
      country: "JP",
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
    },
  };

  const patchATransport = toTransportJson(patchA);
  const patchBTransport = toTransportJson(patchB);

  let patchFlip = false;
  let patchFlipRaw = false;

  const bench = new Bench({
    time: options.timeMs,
    warmupTime: options.warmupMs,
  });

  if (options.mode === "max") {
    bench
      .add("gowe encode single raw", () => {
        encodeTransportJson(goweTransportSingle);
      })
      .add("gowe decode transport raw", () => {
        decodeToTransportJson(goweEncodedSingleRaw);
      })
      .add("gowe encode batch256 raw", () => {
        encodeBatchTransportJson(goweTransportBatch);
      })
      .add("gowe patch session raw", () => {
        patchFlipRaw = !patchFlipRaw;
        rawSessionEncoder.encodePatchTransportJson(
          patchFlipRaw ? patchATransport : patchBTransport,
        );
      });
  } else {
    bench
      .add("gowe encode single", () => {
        encode(singleRecord);
      })
      .add("gowe encode single raw", () => {
        encodeTransportJson(goweTransportSingle);
      })
      .add("gowe decode single", () => {
        decode(goweEncodedSingle);
      })
      .add("gowe decode transport raw", () => {
        decodeToTransportJson(goweEncodedSingleRaw);
      })
      .add("gowe encode batch256", () => {
        encodeBatch(batchRecords);
      })
      .add("gowe encode batch256 raw", () => {
        encodeBatchTransportJson(goweTransportBatch);
      })
      .add("gowe decode 256 singles", () => {
        for (const encoded of goweEncodedSingles) {
          decode(encoded);
        }
      })
      .add("gowe patch session", () => {
        patchFlip = !patchFlip;
        sessionEncoder.encodePatch(patchFlip ? patchA : patchB);
      })
      .add("gowe patch session raw", () => {
        patchFlipRaw = !patchFlipRaw;
        rawSessionEncoder.encodePatchTransportJson(
          patchFlipRaw ? patchATransport : patchBTransport,
        );
      })
      .add("json stringify batch", () => {
        JSON.stringify(batchRecordsJson);
      })
      .add("json parse batch", () => {
        JSON.parse(jsonBatchText);
      })
      .add("json stringify single", () => {
        JSON.stringify(singleRecordJson);
      })
      .add("json parse single", () => {
        JSON.parse(jsonSingleText);
      });
  }

  await bench.run();

  const sizeTable = new Table({
    head: ["payload", "gowe (bytes)", "json (bytes)", "size reduction"],
    style: { head: [], border: [] },
  });

  const sizeRows = [
    {
      payload: "single",
      gowe: goweEncodedSingle.byteLength,
      json: jsonEncodedSingle.byteLength,
    },
    {
      payload: "batch(256)",
      gowe: goweEncodedBatch.byteLength,
      json: jsonEncodedBatch.byteLength,
    },
  ];

  for (const row of sizeRows) {
    const reduction = row.json > 0 ? (1 - row.gowe / row.json) * 100 : 0;
    sizeTable.push([
      row.payload,
      formatBytes(row.gowe),
      formatBytes(row.json),
      row.json > 0 ? formatPercent(reduction) : "n/a",
    ]);
  }

  const fastestHz = bench.tasks.reduce((maxHz, task) => {
    const hz = task.result?.hz ?? 0;
    return Math.max(maxHz, hz);
  }, 0);

  const resultTable = new Table({
    head: ["task", "ops/s", "ns/op", "relative", "rme"],
    style: { head: [], border: [] },
  });

  const sortedTasks = [...bench.tasks].sort((a, b) => {
    const aHz = a.result?.hz ?? 0;
    const bHz = b.result?.hz ?? 0;
    return bHz - aHz;
  });

  for (const task of sortedTasks) {
    const hz = task.result?.hz ?? 0;
    const rme = task.result?.rme;
    resultTable.push([
      task.name,
      formatOps(hz),
      formatNsPerOp(hz),
      formatRelativeSpeed(hz, fastestHz),
      typeof rme === "number" ? formatPercent(rme) : "n/a",
    ]);
  }

  console.log("Gowe benchmark");
  console.log(`runtime: ${runtime}`);
  console.log(`backend preference: ${options.backend}`);
  console.log(`mode: ${options.mode}`);
  console.log(`time per task: ${options.timeMs} ms`);
  console.log(`warmup per task: ${options.warmupMs} ms`);
  console.log("");
  console.log("encoded size comparison");
  console.log(sizeTable.toString());
  console.log("");
  console.log("results");
  console.log(resultTable.toString());
}

void run();
