import { expect, test, type BrowserContext } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Участники события и произношение имён (L2–L3).
 *
 * Проверяется то, ради чего поле и заводилось: невыясненное произношение
 * ВИДНО списком, а не теряется среди заполненных строк. Переводчик должен
 * с одного взгляда понимать, по кому ещё спрашивать организатора.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userId: number;
let projectId: number;

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
      data: { email: `e2e-people-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Участники ${stamp}`,
        owner: userId,
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

test("невыясненное произношение видно, и правка его закрывает", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const section = page.locator("section", { hasText: "Кого переводим" });

  // Добавляем без произношения — и это должно быть заметно
  await section.getByLabel("Имя", { exact: true }).fill("Nguyễn Thị Hương");
  await section.getByLabel("Организация").fill("ASEAN");
  await section.getByRole("button", { name: "Добавить" }).click();

  await expect(page.getByText(/произношение не выяснено: 1/)).toBeVisible();

  // Дописываем произношение — предупреждение уходит
  await page.getByLabel("Произношение: Nguyễn Thị Hương").fill("нгуен тхи ХЫОНГ");
  await page
    .locator("li", { hasText: "Nguyễn Thị Hương" })
    .getByRole("button", { name: "сохранить" })
    .click();

  await expect(page.getByText(/произношение не выяснено/)).toHaveCount(0);
  await expect(page.getByLabel("Произношение: Nguyễn Thị Hương")).toHaveValue(
    "нгуен тхи ХЫОНГ",
  );
});

test("участники исчезают вместе с проектом", async ({ page, context }) => {
  // L5: третьи лица без согласия на хранение. Жизни после проекта у них нет.
  const payload = await getPayload({ config });
  const temporary = await payload.create({
    collection: "projects",
    data: {
      title: `Временный ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
      participants: [{ name: `Участник ${stamp}`, pronunciation: "у-ЧАСТ-ник" }],
    },
    overrideAccess: true,
  });

  await signIn(context);
  await page.goto(`/projects/${temporary.id}`);
  await expect(page.getByText(`Участник ${stamp}`)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить проект" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URI });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select 1 from projects_participants where name = $1`,
      [`Участник ${stamp}`],
    );
    expect(rows).toHaveLength(0);
  } finally {
    await client.end();
  }
});
