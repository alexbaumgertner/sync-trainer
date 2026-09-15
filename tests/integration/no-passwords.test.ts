import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Паролей в системе нет (A1–A7).
 *
 * Проверяется не «мы убрали поле», а что парольного входа не существует как
 * механизма: нет колонок с хешами, нет операции логина, а сессию по-прежнему
 * можно получить только кодом на почту или запасным путём через базу.
 *
 * Тест нужен именно такой, потому что обратная дорога тут дешёвая: одна
 * строчка в конфигурации вернёт локальную стратегию вместе со всеми полями,
 * и заметить это по глазам будет нечем.
 */

const { payloadClient } = await import("@/lib/payload");
const { databaseUrl } = await import("@/lib/database-url");
const { issueToken, readToken } = await import("@/lib/session");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;

const sql = async (query: string, params: unknown[] = []) => {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await client.query(query, params);
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `nopw-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
});

afterAll(async () => {
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("в базе", () => {
  it("нет ни одной колонки парольного входа", async () => {
    const { rows } = await sql(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    const columns = rows.map((r) => r.column_name);

    for (const gone of [
      "hash",
      "salt",
      "login_attempts",
      "lock_until",
      "reset_password_token",
      "reset_password_expiration",
    ]) {
      expect(columns, `колонка ${gone} должна была исчезнуть`).not.toContain(gone);
    }
  });

  it("адрес остался и остался уникальным", async () => {
    const { rows } = await sql(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_idx'`,
    );
    // Два пользователя с одним адресом сделали бы вход по коду неоднозначным.
    expect(rows[0]?.indexdef).toContain("UNIQUE");
  });
});

describe("в коллекции", () => {
  it("локальная стратегия отключена, осталась одна — наша", async () => {
    const collection = payload.config.collections.find((c) => c.slug === "users");
    expect(collection?.auth?.disableLocalStrategy).toBe(true);
    expect(collection?.auth?.strategies?.map((s) => s.name)).toEqual(["otp-cookie"]);
  });

  it("пользователь заводится без пароля вовсе", async () => {
    const user = await payload.findByID({
      collection: "users",
      id: userId,
      overrideAccess: true,
    });
    expect(user.email).toBe(`nopw-${stamp}@example.test`);
    expect(user).not.toHaveProperty("hash");
    expect(user).not.toHaveProperty("salt");
    expect(user).not.toHaveProperty("password");
  });

  it("операции логина по паролю больше нет", async () => {
    // Payload отдаёт login только при включённой локальной стратегии.
    await expect(
      payload.login({
        collection: "users",
        data: { email: `nopw-${stamp}@example.test`, password: "что угодно" },
      } as never),
    ).rejects.toThrow();
  });
});

describe("запасной вход", () => {
  it("выдаёт годную сессию по одному лишь доступу к базе и ключу", () => {
    // Ровно то, что делает `npm run session`: без письма, но и без сети —
    // нужен AUTH_SECRET и право читать базу, то есть доступ к серверу.
    const { token } = issueToken(userId);
    expect(readToken(token)).toBe(String(userId));
  });

  it("подделанная кука не проходит", () => {
    const { token } = issueToken(userId);
    const tampered = token.replace(/^\d+/, String(userId + 1));
    expect(readToken(tampered)).toBeNull();
  });
});
