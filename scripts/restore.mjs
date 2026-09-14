/**
 * Восстановление базы из копии:
 *
 *   npm run restore -- ./копия.json.enc
 *   npm run restore -- backups/2026-09-15-03-00-00.json.enc
 *
 * Первый вид — файл на диске, второй — путь в Vercel Blob.
 *
 * ПОРЯДОК ВАЖЕН. Схему создают миграции из репозитория, а не копия:
 *
 *   DATABASE_URI=<адрес пустой базы> npx payload migrate
 *   DATABASE_URI=<адрес пустой базы> npm run restore -- <копия>
 *
 * Скрипт затирает данные в базе назначения. Поэтому он требует подтверждения
 * и отказывается работать, если адрес базы не задан явно: восстановление
 * поверх той самой базы, которую пытаются спасти, — не то, что нужно.
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { decryptDump, backupKey } from "../src/lib/backup.js";
import { restoreDump } from "../src/lib/restore.js";

const source = process.argv[2];
if (!source) {
  console.error("Укажите копию: npm run restore -- ./копия.json.enc");
  process.exit(1);
}

const target = process.env.DATABASE_URI?.trim();
if (!target) {
  console.error(
    "Задайте DATABASE_URI — адрес базы, КУДА восстанавливать.\n" +
      "Явно, а не по умолчанию: иначе копия ляжет поверх той базы, которую спасают.",
  );
  process.exit(1);
}

const load = async () => {
  if (!source.startsWith("backups/")) return readFile(source);

  const { head } = await import("@vercel/blob");
  const blob = await head(source, { access: "private" });
  const response = await fetch(blob.downloadUrl ?? blob.url);
  if (!response.ok) throw new Error(`Не удалось скачать копию: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const raw = await load();

// Зашифрованную копию узнаём по расширению, а не по содержимому: угадывание
// здесь закончилось бы попыткой разобрать шифротекст как JSON.
let plain = raw;
if (source.endsWith(".enc")) {
  const key = backupKey();
  if (!key) {
    console.error("Копия зашифрована, а BACKUP_KEY не задан. Без ключа она бесполезна.");
    process.exit(1);
  }
  plain = decryptDump(raw, key);
}

const dump = JSON.parse(plain.toString("utf8"));
const rows = dump.tables.reduce((sum, t) => sum + t.rows.length, 0);
const host = new URL(target).hostname;

console.log(`\nКопия от ${dump.createdAt}, узел-источник ${dump.source}`);
console.log(`Строк: ${rows}`);
console.log(`\nБаза назначения: ${host}${new URL(target).pathname}`);
console.log("Все данные в ней будут стёрты и заменены копией.\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Введите "восстановить" для подтверждения: ');
rl.close();

if (answer.trim() !== "восстановить") {
  console.log("Отменено.");
  process.exit(0);
}

const report = await restoreDump(dump, target);

console.log("\nГотово.");
for (const table of report.tables.filter((t) => t.rows > 0)) {
  console.log(`  ${table.name}: ${table.rows}`);
}
console.log(`  последовательностей перенесено: ${report.sequences}`);
console.log("\nПроверьте приложение на этой базе, прежде чем считать восстановление удавшимся.");
