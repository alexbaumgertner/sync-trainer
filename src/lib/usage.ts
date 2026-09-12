import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import type { UsageEntry, UsageTotals, UsageSummary } from "./api-types";

export type { UsageEntry, UsageTotals, UsageSummary };

/**
 * Учёт расходов.
 *
 * Важно про точность: количество символов — точное, мы сами их отправили.
 * Доллары — ОЦЕНКА по нашей таблице тарифов (lib/voices.ts), а не факт
 * из счёта Google. Расхождение возможно из-за бесплатного лимита, скидок
 * и изменений прайса, поэтому в UI это подписано как оценка.
 */

const BLOB_PATH = "usage/usage.json";
const LOCAL_PATH = path.join(process.cwd(), ".data", "usage.json");
const MAX_ENTRIES = 200;

export interface UsageState {
  /** Агрегаты живут отдельно от журнала: журнал обрезается, итог — нет. */
  totals: UsageTotals;
  /** ключ — "YYYY-MM" */
  months: Record<string, UsageTotals>;
  entries: UsageEntry[];
}

export type StorageKind = UsageSummary["storage"];

const ZERO: UsageTotals = { usd: 0, chars: 0, generations: 0 };
const EMPTY: UsageState = { totals: { ...ZERO }, months: {}, entries: [] };
let memory: UsageState = EMPTY;

function storageKind(): StorageKind {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "blob";
  // На Vercel файловая система только для чтения (кроме /tmp), поэтому
  // без Blob-стора остаётся память: цифры сбросятся при перезапуске.
  if (process.env.VERCEL) return "memory";
  return "file";
}

/* ------------------------------- чтение ------------------------------- */

async function readState(): Promise<{ state: UsageState; etag?: string }> {
  const kind = storageKind();

  if (kind === "blob") {
    const result = await get(BLOB_PATH, { access: "private", useCache: false });
    if (!result) return { state: EMPTY };
    const text = await new Response(result.stream).text();
    return { state: parse(text), etag: result.headers?.get("etag") ?? undefined };
  }

  if (kind === "file") {
    try {
      return { state: parse(await fs.readFile(LOCAL_PATH, "utf8")) };
    } catch {
      return { state: EMPTY };
    }
  }

  return { state: memory };
}

function parse(text: string): UsageState {
  let data: Partial<UsageState>;
  try {
    data = JSON.parse(text) as Partial<UsageState>;
  } catch {
    return EMPTY;
  }
  if (!data || typeof data !== "object") return EMPTY;

  const entries = Array.isArray(data.entries) ? data.entries : [];
  // Файл мог быть записан ранней версией без агрегатов — восстанавливаем
  // их из журнала, чтобы старые данные не потерялись.
  if (!data.totals) return { ...rebuild(entries), entries };

  return { totals: data.totals, months: data.months ?? {}, entries };
}

function rebuild(entries: UsageEntry[]): { totals: UsageTotals; months: Record<string, UsageTotals> } {
  const totals = { ...ZERO };
  const months: Record<string, UsageTotals> = {};
  for (const e of entries) add(totals, months, e);
  return { totals, months };
}

function add(totals: UsageTotals, months: Record<string, UsageTotals>, entry: UsageEntry): void {
  totals.usd += entry.costUsd;
  totals.chars += entry.chars;
  totals.generations += 1;

  const key = entry.at.slice(0, 7);
  const month = months[key] ?? { ...ZERO };
  month.usd += entry.costUsd;
  month.chars += entry.chars;
  month.generations += 1;
  months[key] = month;
}

/* ------------------------------- запись ------------------------------- */

async function writeState(state: UsageState, etag?: string): Promise<void> {
  const kind = storageKind();
  const body = JSON.stringify(state, null, 2);

  if (kind === "blob") {
    await put(BLOB_PATH, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      ...(etag ? { ifMatch: etag } : {}),
    });
    return;
  }

  if (kind === "file") {
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, body, "utf8");
    return;
  }

  memory = state;
}

/**
 * Дописывает запись. На Blob используется ifMatch: если между чтением и
 * записью кто-то успел сохранить свою генерацию, повторяем цикл, иначе
 * параллельные запросы затирали бы счётчик друг друга.
 */
export async function recordUsage(entry: UsageEntry): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await readState();
    const totals = { ...state.totals };
    const months = { ...state.months };
    add(totals, months, entry);
    const next: UsageState = {
      totals,
      months,
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    };
    try {
      await writeState(next, etag);
      return;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError && attempt < 3) continue;
      throw error;
    }
  }
}

/* ------------------------------- сводка ------------------------------- */

export async function readUsage(): Promise<UsageSummary> {
  const { state } = await readState();
  const kind = storageKind();
  const month = state.months[new Date().toISOString().slice(0, 7)] ?? ZERO;
  const budget = Number(process.env.TTS_BUDGET_USD ?? "");

  return {
    totalUsd: state.totals.usd,
    totalChars: state.totals.chars,
    generations: state.totals.generations,
    monthUsd: month.usd,
    monthChars: month.chars,
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : null,
    storage: kind,
    volatile: kind === "memory",
    entries: state.entries.slice(0, 20),
  };
}
