/**
 * Сводка по продукту:
 *
 *   npm run metrics
 *
 * Считает по тому, что уже лежит в базе, а не только по событиям `activity`:
 * воронка проекта, разборы, приглашения, записи о работе. Поэтому цифры есть
 * с первого запуска, до того как накопятся шаги, — таблицы существовали
 * раньше счётчика, и выкидывать эту историю незачем.
 *
 * Отдельно печатаются шаги из `activity`: их накопление и покажет, где люди
 * останавливаются. Пока их нет, раздел честно пуст.
 */
import { getPayload } from "payload";
import config from "../src/payload.config.js";
import { STEP_LABELS } from "../src/lib/activity-steps.js";

const payload = await getPayload({ config });
const count = async (collection, where) =>
  (await payload.count({ collection, where, overrideAccess: true })).totalDocs;

const pct = (part, whole) => (whole ? ` (${Math.round((part / whole) * 100)}%)` : "");
const line = (label, value, whole) =>
  console.log(`  ${label.padEnd(34)} ${String(value).padStart(5)}${whole === undefined ? "" : pct(value, whole)}`);

console.log("\n== Люди ==");
const users = await count("users");
line("учётных записей", users);
line("приглашений отправлено", await count("invitations"));
const accepted = await count("invitations", { acceptedAt: { exists: true } });
line("из них принято", accepted, await count("invitations"));

console.log("\n== Воронка проекта ==");
const projects = await count("projects");
line("проектов заведено", projects);
const withDoc = new Set(
  (await payload.find({ collection: "documents", limit: 5000, depth: 0, overrideAccess: true })).docs
    .map((d) => (typeof d.project === "object" ? d.project?.id : d.project)),
);
line("дошли до загрузки документа", withDoc.size, projects);

const artifacts = (
  await payload.find({ collection: "artifacts", limit: 5000, depth: 0, overrideAccess: true })
).docs;
const byKind = (kind) =>
  new Set(
    artifacts
      .filter((a) => a.kind === kind)
      .map((a) => (typeof a.project === "object" ? a.project?.id : a.project)),
  ).size;
line("дошли до скрипта", byKind("script"), projects);
line("дошли до озвучки", byKind("audio"), projects);

const debriefs = new Set(
  (await payload.find({ collection: "debriefs", limit: 5000, depth: 0, overrideAccess: true })).docs
    .map((d) => (typeof d.project === "object" ? d.project?.id : d.project)),
);
line("дошли до разбора", debriefs.size, projects);

console.log("\n== Записи о работе ==");
const engagements = await count("engagements");
line("записей заведено", engagements);
const rows = (
  await payload.find({ collection: "engagements", limit: 5000, depth: 0, overrideAccess: true })
).docs;
const members = rows.flatMap((r) => r.team ?? []);
line("названо участников", members.length);
line("из них связано с учёткой", members.filter((m) => m.user).length, members.length);
line("подтвердили участие", members.filter((m) => m.status === "confirmed").length, members.length);
line("оспорили или отозвали", members.filter((m) => ["disputed", "withdrawn"].includes(m.status)).length, members.length);

console.log("\n== Деньги ==");
const usage = (
  await payload.find({ collection: "usage-events", limit: 5000, depth: 0, overrideAccess: true })
).docs;
const spent = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
line("обращений к синтезу", usage.length);
console.log(`  ${"потрачено всего".padEnd(34)} ${("$" + spent.toFixed(2)).padStart(5)}`);

console.log("\n== Шаги (activity) ==");
const steps = (
  await payload.find({ collection: "activity", limit: 10000, depth: 0, overrideAccess: true })
).docs;
if (!steps.length) {
  console.log("  пока пусто: счётчик заведён сегодня, шаги появятся по мере работы");
} else {
  const tally = new Map();
  for (const s of steps) tally.set(s.step, (tally.get(s.step) ?? 0) + 1);
  for (const [step, label] of Object.entries(STEP_LABELS)) {
    if (tally.has(step)) line(label, tally.get(step));
  }
}

console.log("");
process.exit(0);
