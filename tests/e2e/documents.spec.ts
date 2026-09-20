import { expect, test, type BrowserContext } from "@playwright/test";
import JSZip from "jszip";
import { Client } from "pg";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Требование F2 и предупреждение F3: документ с уникальной фразой проходит
 * обработку, после чего фразы не должно остаться НИ В ОДНОЙ текстовой колонке
 * базы. Это не проверка вёрстки, а проверка обещания о конфиденциальности,
 * которое мы даём переводчикам.
 *
 * С R3 здесь же проверяется обратное обещание: оригинал ОСТАЁТСЯ (S2–S3), пока
 * его не удалят руками. Проверка работает и без ключа модели намеренно — запись
 * о документе и его оригинал появляются до обращения к модели, и отказ модели
 * их не уносит. Это и есть смысл отмены F1: не пришлось бы загружать заново.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `e2e-docs-${stamp}@example.test`;
let userId: number;
let projectId: number;

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Ищет строку во всех текстовых колонках всех таблиц. */
async function findInDatabase(needle: string): Promise<string[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URI });
  await client.connect();
  try {
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and data_type in ('text','character varying','jsonb','json')`,
    );

    const hits: string[] = [];
    for (const { table_name, column_name } of columns.rows) {
      const { rows } = await client.query(
        `select 1 from "${table_name}" where "${column_name}"::text like $1 limit 1`,
        [`%${needle}%`],
      );
      if (rows.length) hits.push(`${table_name}.${column_name}`);
    }
    return hits;
  } finally {
    await client.end();
  }
}

async function signIn(context: BrowserContext) {
  const { token } = issueToken(userId);
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.beforeAll(async () => {
  const payload = await getPayload({ config });
  const user = await payload.create({
    collection: "users",
    data: { email, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Документы ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
    },
    overrideAccess: true,
  });
  projectId = project.id;
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

test("параметры генерации и обещание о хранении видны до загрузки", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  // S3: человек должен узнать о судьбе оригинала до того, как загрузит.
  // Раньше здесь стояло обещание удалить — оно описывало поведение, которого
  // больше нет, и тест на отмене F1 покраснел ровно там, где должен был.
  await expect(page.getByText(/Оригинал хранится, пока вы его не удалите/)).toBeVisible();

  await expect(page.getByLabel("Минут")).toHaveValue("20");
  await expect(page.getByLabel("Спикеров")).toHaveValue("5");
  await expect(page.getByLabel("Терминов")).toHaveValue("40");
  // 100%, а не 105%: ускорение по умолчанию человек получал молча,
  // не трогая поле.
  await expect(page.getByLabel("Темп")).toHaveValue("100%");
  await expect(page.getByLabel("Перечисление на компрессию")).toBeChecked();
});

test("числовое поле стирается досуха, и ноль не прилипает к набранной цифре", async ({
  page,
  context,
}) => {
  // Проверяем значение САМОГО поля, а не состояние нашего компонента: баг
  // ровно в том, что в поле оставался ноль, хотя внутри всё было «в порядке».
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const speakers = page.getByLabel("Спикеров");
  await speakers.fill("");
  await expect(speakers).toHaveValue("");

  await speakers.pressSequentially("5");
  await expect(speakers).toHaveValue("5");

  // Уход из поля приводит значение к допустимому диапазону
  await page.getByLabel("Минут").click();
  await expect(speakers).toHaveValue("5");
});

test("содержимое документа не утекает в базу", async ({ page, context }) => {
  // F2: в базу идут только метаданные. С R3 загрузка вообще не обращается
  // к модели, поэтому проверка стала прямее: загрузили — ищем фразу везде.
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const marker = `МАРКЕР-${Date.now()}`;
  await page.getByLabel("Файл документа").setInputFiles({
    name: "background-note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx(marker),
  });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();

  await expect(page.getByText(/загружен/)).toBeVisible({ timeout: 60_000 });

  expect(await findInDatabase(marker)).toEqual([]);
});

test("посторонний формат отклоняется", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  await page.getByLabel("Файл документа").setInputFiles({
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from("не документ"),
  });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();

  await expect(page.getByText(/Поддерживаются PDF, DOCX и PPTX/)).toBeVisible();
});

test("оригинал остаётся после загрузки и уходит только по кнопке", async ({ page, context }) => {
  // Главная проверка отмены F1.
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const marker = `ХРАНЕНИЕ-${Date.now()}`;
  await page.getByLabel("Файл документа").setInputFiles({
    name: `stored-${Date.now()}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx(marker),
  });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();

  await expect(page.getByText(/загружен/)).toBeVisible({ timeout: 60_000 });
  await page.reload();

  const row = page.locator("li", { hasText: "stored-" }).first();
  await expect(row.getByText("оригинал хранится")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Удалить оригинал" }).click();

  await expect(row.getByText("оригинал удалён")).toBeVisible();
  // Запись о документе остаётся: она говорит, из чего собирали, и по её
  // отпечатку узнаётся повторная загрузка того же файла.
  await expect(row).toContainText("stored-");
});
