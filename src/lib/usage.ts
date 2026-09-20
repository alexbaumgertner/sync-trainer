// Без пометки server-only намеренно: модуль используют и маршруты Next,
// и скрипты обслуживания, которые исполняются вне Next. В клиентский код он
// не попадёт — тянет за собой Payload и доступ к базе.
import { payloadClient } from "./payload";
import { budgetBlock } from "./budget";
import type { UsageEntry, UsageSummary } from "./api-types";

export type { UsageEntry, UsageSummary };
export { budgetBlock };

/**
 * Учёт расходов.
 *
 * Раньше жил одним JSON в Blob, теперь — таблицей в Postgres: расход привязан
 * к пользователю и проекту (B1), а агрегаты считает база, а не перезапись файла.
 * Гонки, ради которых в версии на Blob был ifMatch, исчезли вместе с ней.
 *
 * Важно про точность: символы точные, мы сами их отправили. Доллары — ОЦЕНКА
 * по нашей таблице тарифов, а не факт из счёта Google.
 */

const positive = (raw: string | undefined): number | null => {
  const value = Number(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function globalLimits(): { total: number | null; month: number | null } {
  return {
    total: positive(process.env.TTS_BUDGET_USD),
    month: positive(process.env.TTS_MONTHLY_LIMIT_USD),
  };
}

const defaultUserMonthlyLimit = (): number | null =>
  positive(process.env.TTS_USER_MONTHLY_LIMIT_USD);

const monthStart = (): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
};

export interface RecordArgs {
  userId: number;
  projectId?: number;
  kind: "glossary" | "participants" | "script" | "audio";
  chars: number;
  costUsd: number;
  tier?: string;
  voices?: string[];
}

export async function recordUsage(entry: RecordArgs): Promise<void> {
  const payload = await payloadClient();
  await payload.create({
    collection: "usage-events",
    data: {
      user: entry.userId,
      project: entry.projectId,
      kind: entry.kind,
      chars: entry.chars,
      costUsd: entry.costUsd,
      tier: entry.tier,
      voices: entry.voices,
    },
    overrideAccess: true,
  });
}

/** Суммы по выборке. Постранично: строк немного, но полагаться на это нельзя. */
async function totals(where: Record<string, unknown>): Promise<{
  usd: number;
  chars: number;
  generations: number;
}> {
  const payload = await payloadClient();
  let page = 1;
  let usd = 0;
  let chars = 0;
  let generations = 0;

  for (;;) {
    const batch = await payload.find({
      collection: "usage-events",
      where: where as never,
      limit: 500,
      page,
      depth: 0,
      overrideAccess: true,
    });

    for (const row of batch.docs) {
      usd += row.costUsd ?? 0;
      chars += row.chars ?? 0;
      generations += 1;
    }

    if (!batch.hasNextPage) break;
    page += 1;
  }

  return { usd, chars, generations };
}

export async function readUsage(userId: number, isAdmin: boolean): Promise<UsageSummary> {
  const payload = await payloadClient();
  const since = monthStart();

  const [mine, mineMonth, everyone, everyoneMonth, recent, user] = await Promise.all([
    totals({ user: { equals: userId } }),
    totals({ and: [{ user: { equals: userId } }, { createdAt: { greater_than_equal: since } }] }),
    totals({}),
    totals({ createdAt: { greater_than_equal: since } }),
    payload.find({
      collection: "usage-events",
      where: { user: { equals: userId } },
      sort: "-createdAt",
      limit: 20,
      depth: 0,
      overrideAccess: true,
    }),
    payload.findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true }),
  ]);

  const limits = globalLimits();
  const remainingByTotal = limits.total === null ? null : limits.total - everyone.usd;
  const remainingByMonth = limits.month === null ? null : limits.month - everyoneMonth.usd;
  const remaining = [remainingByTotal, remainingByMonth].filter(
    (value): value is number => value !== null,
  );

  return {
    totalUsd: mine.usd,
    totalChars: mine.chars,
    generations: mine.generations,
    monthUsd: mineMonth.usd,
    monthChars: mineMonth.chars,
    monthLimitUsd: user?.monthlyLimitUsd ?? defaultUserMonthlyLimit(),
    globalRemainingUsd: remaining.length ? Math.min(...remaining) : null,
    global: isAdmin
      ? {
          totalUsd: everyone.usd,
          monthUsd: everyoneMonth.usd,
          generations: everyone.generations,
          budgetUsd: limits.total,
          monthLimitUsd: limits.month,
        }
      : null,
    entries: recent.docs.map(
      (row): UsageEntry => ({
        at: row.createdAt,
        chars: row.chars ?? 0,
        costUsd: row.costUsd ?? 0,
        tier: row.tier ?? "",
        voices: Array.isArray(row.voices) ? (row.voices as string[]) : [],
        format: "",
        chunks: 0,
        seconds: 0,
      }),
    ),
  };
}
