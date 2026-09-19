import { expect, test, type BrowserContext } from "@playwright/test";
import JSZip from "jszip";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Порядок работы целиком: материалы → глоссарий → скрипт (N1–N7).
 *
 * Ради этого порядка затевался релиз, и проверить его можно только так —
 * пройдя весь путь на собранном приложении с настоящей моделью. Модульные
 * тесты видят промт, но не видят главного: что выверенный руками эквивалент
 * доживает до скрипта и не оказывается переписан следующей генерацией.
 *
 * Тест медленный — две генерации подряд. Без ключа модели он пропускается,
 * а не притворяется зелёным: проверка, которая проходит и тогда, когда
 * проверять нечего, хуже отсутствующей.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userId: number;
let projectId: number;

const HAS_KEY = Boolean(process.env.GEMINI_API_KEY?.trim());

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

/** Материал с узнаваемой терминологией: из него и должен вырасти глоссарий. */
const MATERIAL = [
  "Agenda of the intergovernmental panel on climate finance.",
  "Speakers will discuss the framework agreement on loss and damage,",
  "the replenishment cycle of the Green Climate Fund, blended finance",
  "instruments, concessional lending, adaptation gap, and the role of",
  "multilateral development banks in de-risking private capital.",
  "The just transition mechanism and carbon border adjustment are on",
  "the agenda as well, alongside nationally determined contributions.",
].join(" ");

async function signIn(context: BrowserContext) {
  const { token } = issueToken(userId);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.beforeAll(async () => {
  const payload = await getPayload({ config });
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `e2e-flow-${stamp}@example.test`, displayName: "Кабина", role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Порядок ${stamp}`,
        owner: userId,
        eventName: "Климатическое финансирование",
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

test("глоссарий собирается по материалам, и скрипт растёт из него", async ({ page, context }) => {
  test.skip(!HAS_KEY, "без ключа модели проверять нечего");
  test.setTimeout(5 * 60_000);

  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  // 1. Материалы
  await page.getByLabel("Файл документа").setInputFiles({
    name: "agenda.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await makeDocx(MATERIAL),
  });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByText(/загружен/)).toBeVisible({ timeout: 60_000 });
  await page.reload();

  // 2. Глоссарий по ним
  await page.getByRole("button", { name: "Собрать глоссарий" }).click();
  await expect(page.getByText(/\d+ терминов/)).toBeVisible({ timeout: 4 * 60_000 });

  // 3. Выверка: пишем эквивалент, которого модель бы не выбрала.
  //
  // Правим через базу, а не через форму: щелчки по редактору проверяет
  // `glossary.spec.ts`, и дублировать их здесь значит добавить хрупкости
  // в тест, который и так идёт четыре минуты. Здесь важно другое — что
  // выверенное переживёт генерацию.
  const payload = await getPayload({ config });
  const before = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    sort: "sourceTerm",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  expect(before.docs.length).toBe(1);

  const term = before.docs[0].sourceTerm;
  const mine = `эквивалент-${stamp}`;
  await payload.update({
    collection: "glossary-terms",
    id: before.docs[0].id,
    data: { targetTerm: mine, status: "verified" },
    overrideAccess: true,
  });
  await page.reload();

  // 4. Скрипт по выверенному глоссарию
  await page.getByRole("button", { name: "Сгенерировать скрипт" }).click();
  await expect(page.getByRole("link", { name: "Скачать" }).first()).toBeVisible({
    timeout: 4 * 60_000,
  });

  // 5. Правка пережила генерацию (N7).
  //
  // Это проверка пути целиком, а не самого заслона: со снятым заслоном она
  // однажды прошла — модель просто не повторила термин. Заслон проверяется
  // напрямую в `glossary-store.test.ts`, где кандидаты задаются руками.
  const after = await payload.find({
    collection: "glossary-terms",
    where: { and: [{ project: { equals: projectId } }, { sourceTerm: { equals: term } }] },
    limit: 5,
    depth: 0,
    overrideAccess: true,
  });

  expect(after.docs).toHaveLength(1);
  expect(after.docs[0].targetTerm).toBe(mine);
  // Правка руками снимает пометку «предложен моделью», и вернуть её
  // генерация не вправе.
  expect(after.docs[0].status).not.toBe("suggested");
});
