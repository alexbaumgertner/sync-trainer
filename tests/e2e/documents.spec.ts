import { expect, test, type BrowserContext } from "@playwright/test";
import JSZip from "jszip";
import { Client } from "pg";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Требования F1–F2 целиком: документ с уникальной фразой проходит обработку,
 * после чего фразы не должно остаться НИ В ОДНОЙ колонке базы, а оригинала —
 * в хранилище. Это не проверка вёрстки, а проверка обещания о конфиденциальности,
 * которое мы даём переводчикам.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SECRET = `СЕКРЕТНАЯ-ФРАЗА-${stamp}`;
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
    data: { email, password: `pw-${stamp}`, role: "interpreter" },
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

test("документ разбирается, а его текст не попадает в базу", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  // Предупреждение об удалении оригинала должно быть видно до загрузки (F3)
  await expect(page.getByText(/Оригинал удаляется сразу после разбора/)).toBeVisible();

  await page.getByLabel("Файл документа").setInputFiles({
    name: "background-note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx(SECRET),
  });
  await page.getByRole("button", { name: "Загрузить" }).click();

  await expect(page.getByText(/Готово\./)).toBeVisible({ timeout: 30_000 });
  // Имя встречается и в сообщении об успехе, и в списке — нужен список
  await expect(page.getByText("background-note.docx", { exact: true })).toBeVisible();
  await expect(page.getByText("оригинал удалён")).toBeVisible();

  // Главное: содержимого документа нет нигде в базе (F2)
  const hits = await findInDatabase(SECRET);
  expect(hits, `фраза найдена в: ${hits.join(", ")}`).toEqual([]);
});

test("посторонний формат отклоняется", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  await page.getByLabel("Файл документа").setInputFiles({
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from("не документ"),
  });
  await page.getByRole("button", { name: "Загрузить" }).click();

  await expect(page.getByText(/Поддерживаются PDF, DOCX и PPTX/)).toBeVisible();
});
