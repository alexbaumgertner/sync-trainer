import { Client } from "pg";
import { DUMP_VERSION, type Dump } from "./backup";

/**
 * Восстановление из копии (D5).
 *
 * Схему создают миграции из репозитория — их нужно применить к пустой базе
 * ДО восстановления. Здесь только данные.
 *
 * Копия, из которой ни разу не восстанавливались, — это предположение,
 * а не копия. Поэтому восстановление живёт в коде и проверяется тестом,
 * а не описано словами в инструкции.
 */

export interface RestoreReport {
  tables: { name: string; rows: number }[];
  sequences: number;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function restoreDump(
  dump: Dump,
  connectionString: string,
): Promise<RestoreReport> {
  if (dump.version !== DUMP_VERSION) {
    throw new Error(
      `Копия версии ${dump.version}, а этот код понимает ${DUMP_VERSION}. ` +
        "Восстанавливать вслепую нельзя.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  const report: RestoreReport = { tables: [], sequences: 0 };

  try {
    await client.query("BEGIN");

    // Чистим в обратном порядке: сначала дети, потом родители, иначе
    // удаление упрётся во внешние ключи ровно как вставка в прямом.
    for (const table of [...dump.tables].reverse()) {
      await client.query(`DELETE FROM ${quote(table.name)}`);
    }

    for (const table of dump.tables) {
      if (!table.rows.length) {
        report.tables.push({ name: table.name, rows: 0 });
        continue;
      }

      // Набор колонок берём из первой строки: дамп однороден по построению,
      // все строки одной таблицы приходят из одного SELECT *.
      const columns = Object.keys(table.rows[0]);
      const columnList = columns.map(quote).join(", ");

      for (const row of table.rows) {
        const values = columns.map((column) => normalize(row[column]));
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${quote(table.name)} (${columnList}) VALUES (${placeholders})`,
          values,
        );
      }

      report.tables.push({ name: table.name, rows: table.rows.length });
    }

    // Последовательности: без этого первая же вставка после восстановления
    // столкнётся с уже существующим идентификатором.
    for (const sequence of dump.sequences) {
      await client.query(`SELECT setval($1, $2::bigint, true)`, [
        `public.${sequence.name}`,
        sequence.value,
      ]);
      report.sequences += 1;
    }

    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * JSON не знает ни дат, ни типов Postgres — после сериализации дата стала
 * строкой, а jsonb-колонка обычным объектом или массивом.
 *
 * Проверено на живой базе, потому что поведение неочевидно и различается:
 *
 *   объект как есть          → ok
 *   объект через stringify   → ok
 *   **массив как есть        → отказ**
 *   массив через stringify   → ok
 *
 * Массив драйвер переводит в синтаксис массива Postgres — `{"a","b"}`, —
 * а jsonb такого не принимает. Поэтому сериализуем сами: на объектах это
 * ничего не меняет, а на массивах спасает восстановление. Колонка
 * `usage_events.voices` — как раз массив.
 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
