/**
 * Проверка резервной копии, ничего не восстанавливая:
 *
 *   npm run backup:verify -- ~/Downloads/sync-trainer-2026-09-15.json.enc
 *
 * Отвечает на один вопрос — «этот файл вообще читается моим ключом и что
 * в нём лежит». Раз в несколько месяцев это стоит делать глазами: проверка
 * в тестах ловит поломки кода, но не то, что копия стала неполной из-за
 * недосмотра в схеме.
 *
 * Базы не касается. Чтобы развернуть копию — `npm run restore`.
 */
import { readFile } from "node:fs/promises";
import { decryptDump, backupKey, DUMP_VERSION } from "../src/lib/backup.js";

const path = process.argv[2];
if (!path) {
  console.error("Укажите файл: npm run backup:verify -- ~/Downloads/копия.json.enc");
  process.exit(1);
}

let raw;
try {
  raw = await readFile(path.replace(/^~/, process.env.HOME ?? "~"));
} catch (error) {
  console.error(`Не удалось открыть файл: ${error.message}`);
  console.error("Вложение из письма нужно сначала скачать.");
  process.exit(1);
}

let plain = raw;
if (path.endsWith(".enc")) {
  let key;
  try {
    key = backupKey();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!key) {
    console.error(
      "Копия зашифрована, а BACKUP_KEY не задан.\n" +
        "Возьмите ключ из менеджера паролей:\n" +
        "  BACKUP_KEY='...' npm run backup:verify -- " + path,
    );
    process.exit(1);
  }
  try {
    plain = decryptDump(raw, key);
  } catch {
    // GCM отвергает и чужой ключ, и подделанный файл, различить их нельзя.
    console.error("Расшифровать не удалось: либо ключ не тот, либо файл повреждён.");
    process.exit(1);
  }
}

let dump;
try {
  dump = JSON.parse(plain.toString("utf8"));
} catch {
  console.error("Файл расшифровался, но это не копия: JSON не разбирается.");
  process.exit(1);
}

if (dump.version !== DUMP_VERSION) {
  console.warn(
    `Внимание: копия версии ${dump.version}, этот код понимает ${DUMP_VERSION}.`,
  );
}

const rows = dump.tables.reduce((sum, t) => sum + t.rows.length, 0);
const age = Math.round((Date.now() - Date.parse(dump.createdAt)) / 36e5);

console.log(`\nКопия от ${dump.createdAt} (${age} ч назад)`);
console.log(`Узел-источник: ${dump.source}`);
console.log(`Всего строк: ${rows}\n`);

for (const table of dump.tables) {
  if (table.rows.length) console.log(`  ${table.name}: ${table.rows.length}`);
}
console.log(`\n  последовательностей: ${dump.sequences.length}`);

// Пустая копия читается и разбирается, но спасёт ровно ничего.
const users = dump.tables.find((t) => t.name === "users")?.rows.length ?? 0;
if (!users) {
  console.error("\nВ копии НЕТ ни одного пользователя. Это не рабочая копия.");
  process.exit(1);
}

console.log("\nКопия читается и непуста. Развернуть её: npm run restore -- " + path);
