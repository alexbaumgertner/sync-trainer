/**
 * Перенос накопленного счётчика расходов из Blob (или локального файла)
 * в таблицу usage_events (требование D2).
 *
 *   npm run migrate:usage -- owner@example.com [--apply]
 *
 * Без --apply только показывает, что будет сделано.
 *
 * Тонкость, из-за которой нельзя просто переложить записи: журнал в старом
 * формате обрезан до 200 последних, а итоги считались отдельно и полные.
 * Поэтому переносятся все имеющиеся записи плюс одна балансирующая на
 * разницу — иначе суммы после переноса не сойдутся с прежними.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getPayload } from "payload";
import config from "../src/payload.config.js";

const args = process.argv.slice(2);
const email = args.find((a) => a.includes("@"));
const apply = args.includes("--apply");

if (!email) {
  console.error("Укажите почту владельца: npm run migrate:usage -- owner@example.com [--apply]");
  process.exit(1);
}

async function loadOldState() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const { get } = await import("@vercel/blob");
    const result = await get("usage/usage.json", { access: "private", useCache: false });
    if (!result) return null;
    return JSON.parse(await new Response(result.stream).text());
  }

  const local = path.join(process.cwd(), ".data", "usage.json");
  try {
    return JSON.parse(await fs.readFile(local, "utf8"));
  } catch {
    return null;
  }
}

const state = await loadOldState();
if (!state) {
  console.log("Старого счётчика не найдено — переносить нечего.");
  process.exit(0);
}

const entries = Array.isArray(state.entries) ? state.entries : [];
const oldTotals = state.totals ?? { usd: 0, chars: 0, generations: 0 };
const inEntries = entries.reduce(
  (acc, e) => ({
    usd: acc.usd + (e.costUsd ?? 0),
    chars: acc.chars + (e.chars ?? 0),
    generations: acc.generations + 1,
  }),
  { usd: 0, chars: 0, generations: 0 },
);

const residual = {
  usd: +(oldTotals.usd - inEntries.usd).toFixed(6),
  chars: oldTotals.chars - inEntries.chars,
  generations: oldTotals.generations - inEntries.generations,
};

console.log(`\nСтарые итоги:    $${oldTotals.usd.toFixed(4)}, ${oldTotals.chars} симв., ${oldTotals.generations} генераций`);
console.log(`В журнале:       $${inEntries.usd.toFixed(4)}, ${inEntries.chars} симв., ${entries.length} записей`);
console.log(`Разница (баланс): $${residual.usd.toFixed(4)}, ${residual.chars} симв., ${residual.generations} генераций`);

if (!apply) {
  console.log("\nЭто просмотр. Повторите с --apply, чтобы записать.\n");
  process.exit(0);
}

const payload = await getPayload({ config });
const users = await payload.find({
  collection: "users",
  where: { email: { equals: email.toLowerCase() } },
  limit: 1,
  overrideAccess: true,
});

const user = users.docs[0];
if (!user) {
  console.error(`Пользователь ${email} не найден. Сначала создайте учётную запись.`);
  process.exit(1);
}

for (const entry of entries) {
  await payload.create({
    collection: "usage-events",
    data: {
      user: user.id,
      kind: "audio",
      chars: entry.chars ?? 0,
      costUsd: entry.costUsd ?? 0,
      tier: entry.tier ?? "",
      voices: entry.voices ?? [],
      createdAt: entry.at,
    },
    overrideAccess: true,
  });
}

if (residual.usd > 0.000001 || residual.chars > 0) {
  await payload.create({
    collection: "usage-events",
    data: {
      user: user.id,
      kind: "audio",
      chars: Math.max(residual.chars, 0),
      costUsd: Math.max(residual.usd, 0),
      tier: "перенос из Blob",
      voices: [],
    },
    overrideAccess: true,
  });
  console.log("Добавлена балансирующая запись за обрезанную часть журнала.");
}

const { readUsage } = await import("../src/lib/usage.js");
const after = await readUsage(user.id, true);
console.log(`\nПосле переноса:  $${after.totalUsd.toFixed(4)}, ${after.totalChars} симв., ${after.generations} генераций`);
console.log(
  Math.abs(after.totalUsd - oldTotals.usd) < 0.000001 && after.totalChars === oldTotals.chars
    ? "Суммы сошлись.\n"
    : "ВНИМАНИЕ: суммы не сошлись, проверьте вручную.\n",
);
process.exit(0);
