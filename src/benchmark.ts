import fs from "node:fs";
import { Bench } from "tinybench";
import Table from "cli-table3";
import {
  decode as decodeMsgpack,
  encode as encodeMsgpack,
} from "@msgpack/msgpack";
import { decode as decodeCbor, encode as encodeCbor } from "cbor-x";
import {
  deserialize as deserializeBson,
  serialize as serializeBson,
} from "bson";
import {
  createSessionEncoder,
  decode,
  decodeDirect,
  decodeToCompactJson,
  decodeToTransportJson,
  encode,
  encodeBatch,
  encodeBatchCompact,
  encodeBatchCompactJson,
  encodeBatchDirect,
  encodeBatchTransportJson,
  encodeCompact,
  encodeCompactJson,
  encodeDirect,
  encodeTransportJson,
  init,
  toCompactJson,
  toCompactJsonBatch,
  toTransportJson,
  toTransportJsonBatch,
  type RecurramValue,
} from "recurram";

type BackendKind = "napi" | "wasm";
type BenchMode = "full" | "max";

interface CliOptions {
  backend: BackendKind;
  timeMs: number;
  warmupMs: number;
  mode: BenchMode;
  recurramVsMsgpackOnly: boolean;
  markdownOut: string | null;
}

function parseCliOptions(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    backend: "napi",
    timeMs: 1000,
    warmupMs: 250,
    mode: "full",
    recurramVsMsgpackOnly: false,
    markdownOut: null,
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
      continue;
    }

    if (arg === "--recurram-vs-msgpack-only") {
      options.recurramVsMsgpackOnly = true;
    }

    if (arg === "--markdown-out" && argv[i + 1]) {
      options.markdownOut = argv[i + 1];
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

function formatReduction(smaller: number, larger: number): string {
  if (smaller <= 0 || larger <= 0) {
    return "n/a";
  }

  return formatPercent((1 - smaller / larger) * 100);
}

function formatRelativeSpeed(hz: number, fastestHz: number): string {
  if (hz <= 0 || fastestHz <= 0) {
    return "n/a";
  }

  return `${(hz / fastestHz).toFixed(2)}x`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

interface SizeRowData {
  payload: string;
  recurram: number;
  msgpack: number;
  cbor: number;
  bson: number;
  json: number;
}

function buildMarkdownReport(params: {
  runtime: string;
  options: CliOptions;
  includeJsonBaseline: boolean;
  sizeRows: SizeRowData[];
  sortedTasks: { name: string; result?: { hz?: number; rme?: number } }[];
  fastestHz: number;
}): string {
  const {
    runtime,
    options,
    includeJsonBaseline,
    sizeRows,
    sortedTasks,
    fastestHz,
  } = params;

  const lines: string[] = [
    "## Recurram benchmark",
    "",
    `- **Runtime:** ${runtime}`,
    `- **Backend preference:** ${options.backend}`,
    `- **Mode:** ${options.mode}`,
    `- **Baselines:** ${includeJsonBaseline ? "recurram, msgpack, json" : "recurram, msgpack"}`,
    `- **Time per task:** ${options.timeMs} ms`,
    `- **Warmup per task:** ${options.warmupMs} ms`,
    "",
    "### Encoded size comparison",
    "",
  ];

  const sizeHead = [
    "payload",
    "recurram (bytes)",
    "msgpack (bytes)",
    "cbor (bytes)",
    "bson (bytes)",
  ];
  if (includeJsonBaseline) {
    sizeHead.push("json (bytes)");
  }
  sizeHead.push("vs msgpack", "vs cbor", "vs bson");
  if (includeJsonBaseline) {
    sizeHead.push("vs json");
  }
  lines.push("| " + sizeHead.join(" | ") + " |");
  lines.push("| " + sizeHead.map(() => "---").join(" | ") + " |");

  for (const row of sizeRows) {
    const cells = [
      escapeMarkdownCell(row.payload),
      formatBytes(row.recurram),
      formatBytes(row.msgpack),
      formatBytes(row.cbor),
      formatBytes(row.bson),
    ];
    if (includeJsonBaseline) {
      cells.push(formatBytes(row.json));
    }
    cells.push(
      formatReduction(row.recurram, row.msgpack),
      formatReduction(row.recurram, row.cbor),
      formatReduction(row.recurram, row.bson),
    );
    if (includeJsonBaseline) {
      cells.push(formatReduction(row.recurram, row.json));
    }
    lines.push("| " + cells.join(" | ") + " |");
  }

  lines.push("", "### Throughput (sorted by ops/s)", "", "");
  lines.push("| task | ops/s | ns/op | relative | rme |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");

  for (const task of sortedTasks) {
    const hzI = task.result?.hz ?? 0;
    const rme = task.result?.rme;
    lines.push(
      "| " +
        [
          escapeMarkdownCell(task.name),
          formatOps(hzI),
          formatNsPerOp(hzI),
          formatRelativeSpeed(hzI, fastestHz),
          typeof rme === "number" ? formatPercent(rme) : "n/a",
        ].join(" | ") +
        " |",
    );
  }

  return lines.join("\n");
}

function toJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await init({ prefer: options.backend });
  const includeJsonBaseline = !options.recurramVsMsgpackOnly;

  const singleRecord: RecurramValue = {
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

  const batchRecords: RecurramValue[] = Array.from(
    { length: 256 },
    (_, index) => {
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
    },
  );

  const batchRecordsJson = batchRecords as unknown[];

  const recurramEncodedSingle = encode(singleRecord);
  const recurramEncodedBatch = encodeBatch(batchRecords);
  const recurramEncodedSingles = batchRecords.map((value) => encode(value));
  const recurramTransportSingle = toTransportJson(singleRecord);
  const recurramTransportBatch = toTransportJsonBatch(batchRecords);
  const recurramCompactSingle = toCompactJson(singleRecord);
  const recurramCompactBatch = toCompactJsonBatch(batchRecords);
  const recurramEncodedSingleRaw = encodeTransportJson(recurramTransportSingle);
  const jsonEncodedSingle = toJsonBytes(singleRecordJson);
  const jsonEncodedBatch = toJsonBytes(batchRecordsJson);
  const msgpackEncodedSingle = encodeMsgpack(singleRecordJson);
  const msgpackEncodedBatch = encodeMsgpack(batchRecordsJson);
  const msgpackEncodedSingles = batchRecordsJson.map((value) =>
    encodeMsgpack(value),
  );
  const cborEncodedSingle = encodeCbor(singleRecordJson);
  const cborEncodedBatch = encodeCbor(batchRecordsJson);
  const cborEncodedSingles = batchRecordsJson.map((value) => encodeCbor(value));
  const bsonEncodedSingle = serializeBson(
    singleRecordJson as Record<string, unknown>,
  );
  const bsonEncodedBatch = serializeBson({ records: batchRecordsJson });
  const bsonEncodedSingles = batchRecordsJson.map((value) =>
    serializeBson(value as Record<string, unknown>),
  );
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
  rawSessionEncoder.encodeTransportJson(recurramTransportSingle);

  const directSessionEncoder = createSessionEncoder({
    enableStatePatch: true,
    enableTemplateBatch: true,
  });
  directSessionEncoder.encodeDirect(singleRecord);

  const compactSessionEncoder = createSessionEncoder({
    enableStatePatch: true,
    enableTemplateBatch: true,
  });
  compactSessionEncoder.encodeCompact(singleRecord);

  const patchA: RecurramValue = {
    ...singleRecord,
    score: 99.1,
    profile: {
      country: "JP",
      locale: "ja-JP",
      timeZone: "Asia/Seoul",
    },
  };

  const patchB: RecurramValue = {
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
  const patchACompact = toCompactJson(patchA);
  const patchBCompact = toCompactJson(patchB);

  let patchFlip = false;
  let patchFlipRaw = false;
  let patchFlipDirect = false;
  let patchFlipCompact = false;
  let patchFlipCompactRaw = false;

  const bench = new Bench({
    time: options.timeMs,
    warmupTime: options.warmupMs,
  });

  if (options.mode === "max") {
    bench
      .add("recurram encode single (direct)", () => {
        encodeDirect(singleRecord);
      })
      .add("recurram encode single (raw json)", () => {
        encodeTransportJson(recurramTransportSingle);
      })
      .add("recurram encode single (compact)", () => {
        encodeCompact(singleRecord);
      })
      .add("recurram encode single (compact raw)", () => {
        encodeCompactJson(recurramCompactSingle);
      })
      .add("recurram decode single (direct)", () => {
        decodeDirect(recurramEncodedSingleRaw);
      })
      .add("recurram decode single (raw json)", () => {
        decodeToTransportJson(recurramEncodedSingleRaw);
      })
      .add("recurram decode single (compact raw)", () => {
        decodeToCompactJson(recurramEncodedSingleRaw);
      })
      .add("msgpack encode single", () => {
        encodeMsgpack(singleRecordJson);
      })
      .add("msgpack decode single", () => {
        decodeMsgpack(msgpackEncodedSingle);
      })
      .add("cbor encode single", () => {
        encodeCbor(singleRecordJson);
      })
      .add("cbor decode single", () => {
        decodeCbor(cborEncodedSingle);
      })
      .add("bson serialize single", () => {
        serializeBson(singleRecordJson as Record<string, unknown>);
      })
      .add("bson deserialize single", () => {
        deserializeBson(bsonEncodedSingle);
      })
      .add("recurram encode batch256 (direct)", () => {
        encodeBatchDirect(batchRecords);
      })
      .add("recurram encode batch256 (raw json)", () => {
        encodeBatchTransportJson(recurramTransportBatch);
      })
      .add("recurram encode batch256 (compact)", () => {
        encodeBatchCompact(batchRecords);
      })
      .add("recurram encode batch256 (compact raw)", () => {
        encodeBatchCompactJson(recurramCompactBatch);
      })
      .add("msgpack encode batch256", () => {
        encodeMsgpack(batchRecordsJson);
      })
      .add("msgpack decode 256 singles", () => {
        for (const encoded of msgpackEncodedSingles) {
          decodeMsgpack(encoded);
        }
      })
      .add("cbor encode batch256", () => {
        encodeCbor(batchRecordsJson);
      })
      .add("cbor decode 256 singles", () => {
        for (const encoded of cborEncodedSingles) {
          decodeCbor(encoded);
        }
      })
      .add("bson serialize batch256", () => {
        serializeBson({ records: batchRecordsJson });
      })
      .add("bson deserialize 256 singles", () => {
        for (const encoded of bsonEncodedSingles) {
          deserializeBson(encoded);
        }
      })
      .add("recurram patch session (direct)", () => {
        patchFlipDirect = !patchFlipDirect;
        directSessionEncoder.encodePatchDirect(
          patchFlipDirect ? patchA : patchB,
        );
      })
      .add("recurram patch session (raw json)", () => {
        patchFlipRaw = !patchFlipRaw;
        rawSessionEncoder.encodePatchTransportJson(
          patchFlipRaw ? patchATransport : patchBTransport,
        );
      })
      .add("recurram patch session (compact)", () => {
        patchFlipCompact = !patchFlipCompact;
        compactSessionEncoder.encodePatchCompact(
          patchFlipCompact ? patchA : patchB,
        );
      })
      .add("recurram patch session (compact raw)", () => {
        patchFlipCompactRaw = !patchFlipCompactRaw;
        compactSessionEncoder.encodePatchCompactJson(
          patchFlipCompactRaw ? patchACompact : patchBCompact,
        );
      });
  } else {
    bench
      .add("recurram encode single", () => {
        encode(singleRecord);
      })
      .add("recurram encode single (direct)", () => {
        encodeDirect(singleRecord);
      })
      .add("recurram encode single (raw json)", () => {
        encodeTransportJson(recurramTransportSingle);
      })
      .add("recurram encode single (compact)", () => {
        encodeCompact(singleRecord);
      })
      .add("recurram encode single (compact raw)", () => {
        encodeCompactJson(recurramCompactSingle);
      })
      .add("recurram decode single", () => {
        decode(recurramEncodedSingle);
      })
      .add("recurram decode single (direct)", () => {
        decodeDirect(recurramEncodedSingleRaw);
      })
      .add("recurram decode single (raw json)", () => {
        decodeToTransportJson(recurramEncodedSingleRaw);
      })
      .add("recurram decode single (compact raw)", () => {
        decodeToCompactJson(recurramEncodedSingleRaw);
      })
      .add("msgpack encode single", () => {
        encodeMsgpack(singleRecordJson);
      })
      .add("msgpack decode single", () => {
        decodeMsgpack(msgpackEncodedSingle);
      })
      .add("cbor encode single", () => {
        encodeCbor(singleRecordJson);
      })
      .add("cbor decode single", () => {
        decodeCbor(cborEncodedSingle);
      })
      .add("bson serialize single", () => {
        serializeBson(singleRecordJson as Record<string, unknown>);
      })
      .add("bson deserialize single", () => {
        deserializeBson(bsonEncodedSingle);
      })
      .add("recurram encode batch256", () => {
        encodeBatch(batchRecords);
      })
      .add("recurram encode batch256 (direct)", () => {
        encodeBatchDirect(batchRecords);
      })
      .add("recurram encode batch256 (raw json)", () => {
        encodeBatchTransportJson(recurramTransportBatch);
      })
      .add("recurram encode batch256 (compact)", () => {
        encodeBatchCompact(batchRecords);
      })
      .add("recurram encode batch256 (compact raw)", () => {
        encodeBatchCompactJson(recurramCompactBatch);
      })
      .add("recurram decode 256 singles", () => {
        for (const encoded of recurramEncodedSingles) {
          decode(encoded);
        }
      })
      .add("msgpack encode batch256", () => {
        encodeMsgpack(batchRecordsJson);
      })
      .add("msgpack decode 256 singles", () => {
        for (const encoded of msgpackEncodedSingles) {
          decodeMsgpack(encoded);
        }
      })
      .add("cbor encode batch256", () => {
        encodeCbor(batchRecordsJson);
      })
      .add("cbor decode 256 singles", () => {
        for (const encoded of cborEncodedSingles) {
          decodeCbor(encoded);
        }
      })
      .add("bson serialize batch256", () => {
        serializeBson({ records: batchRecordsJson });
      })
      .add("bson deserialize 256 singles", () => {
        for (const encoded of bsonEncodedSingles) {
          deserializeBson(encoded);
        }
      })
      .add("recurram patch session", () => {
        patchFlip = !patchFlip;
        sessionEncoder.encodePatch(patchFlip ? patchA : patchB);
      })
      .add("recurram patch session (direct)", () => {
        patchFlipDirect = !patchFlipDirect;
        directSessionEncoder.encodePatchDirect(
          patchFlipDirect ? patchA : patchB,
        );
      })
      .add("recurram patch session (raw json)", () => {
        patchFlipRaw = !patchFlipRaw;
        rawSessionEncoder.encodePatchTransportJson(
          patchFlipRaw ? patchATransport : patchBTransport,
        );
      })
      .add("recurram patch session (compact)", () => {
        patchFlipCompact = !patchFlipCompact;
        compactSessionEncoder.encodePatchCompact(
          patchFlipCompact ? patchA : patchB,
        );
      })
      .add("recurram patch session (compact raw)", () => {
        patchFlipCompactRaw = !patchFlipCompactRaw;
        compactSessionEncoder.encodePatchCompactJson(
          patchFlipCompactRaw ? patchACompact : patchBCompact,
        );
      });

    if (includeJsonBaseline) {
      bench
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
  }

  await bench.run();

  const sizeTableHead = [
    "payload",
    "recurram (bytes)",
    "msgpack (bytes)",
    "cbor (bytes)",
    "bson (bytes)",
  ];

  if (includeJsonBaseline) {
    sizeTableHead.push("json (bytes)");
  }

  sizeTableHead.push("vs msgpack", "vs cbor", "vs bson");

  if (includeJsonBaseline) {
    sizeTableHead.push("vs json");
  }

  const sizeTable = new Table({
    head: sizeTableHead,
    style: { head: [], border: [] },
  });

  const sizeRows = [
    {
      payload: "single",
      recurram: recurramEncodedSingle.byteLength,
      msgpack: msgpackEncodedSingle.byteLength,
      cbor: cborEncodedSingle.byteLength,
      bson: bsonEncodedSingle.byteLength,
      json: jsonEncodedSingle.byteLength,
    },
    {
      payload: "batch(256)",
      recurram: recurramEncodedBatch.byteLength,
      msgpack: msgpackEncodedBatch.byteLength,
      cbor: cborEncodedBatch.byteLength,
      bson: bsonEncodedBatch.byteLength,
      json: jsonEncodedBatch.byteLength,
    },
  ];

  for (const row of sizeRows) {
    const tableRow = [
      row.payload,
      formatBytes(row.recurram),
      formatBytes(row.msgpack),
      formatBytes(row.cbor),
      formatBytes(row.bson),
    ];

    if (includeJsonBaseline) {
      tableRow.push(formatBytes(row.json));
    }

    tableRow.push(
      formatReduction(row.recurram, row.msgpack),
      formatReduction(row.recurram, row.cbor),
      formatReduction(row.recurram, row.bson),
    );

    if (includeJsonBaseline) {
      tableRow.push(formatReduction(row.recurram, row.json));
    }

    sizeTable.push(tableRow);
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

  console.log("Recurram benchmark");
  console.log(`runtime: ${runtime}`);
  console.log(`backend preference: ${options.backend}`);
  console.log(`mode: ${options.mode}`);
  console.log(
    `baseline view: ${includeJsonBaseline ? "recurram, msgpack, json" : "recurram, msgpack"}`,
  );
  console.log(`time per task: ${options.timeMs} ms`);
  console.log(`warmup per task: ${options.warmupMs} ms`);
  console.log("");
  console.log("encoded size comparison");
  console.log(sizeTable.toString());
  console.log("");
  console.log("results");
  console.log(resultTable.toString());

  if (options.markdownOut) {
    const md = buildMarkdownReport({
      runtime,
      options,
      includeJsonBaseline,
      sizeRows,
      sortedTasks,
      fastestHz,
    });
    fs.appendFileSync(options.markdownOut, `${md}\n\n`);
  }
}

void run();
