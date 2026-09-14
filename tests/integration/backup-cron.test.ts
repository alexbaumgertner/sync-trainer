import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Суточный запуск копии (D5).
 *
 * Здесь проверяется не сама выгрузка — она в backup-restore.test.ts, — а то,
 * что вокруг неё: кого пускают, что уезжает в письмо и что происходит, когда
 * ключа шифрования нет. Незашифрованная копия в почте — это адреса
 * приглашённых и глоссарии у постороннего.
 */

const sent: {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailConfigured: () => true,
    sendEmail: async (args: (typeof sent)[number]) => {
      sent.push(args);
    },
  };
});

const blobPuts: string[] = [];
vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return {
    ...actual,
    put: async (pathname: string) => {
      blobPuts.push(pathname);
      return { pathname, url: `https://blob.test/${pathname}` };
    },
    list: async () => ({ blobs: [] }),
    del: async () => {},
  };
});

const { GET } = await import("@/app/api/cron/backup/route");

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://localhost/api/cron/backup", { headers }));

const saved = { ...process.env };

beforeEach(() => {
  sent.length = 0;
  blobPuts.length = 0;
  process.env.BACKUP_EMAIL = "owner@example.test";
  delete process.env.BACKUP_KEY;
  delete process.env.CRON_SECRET;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("кого пускают", () => {
  it("с заданным CRON_SECRET посторонний запрос отклоняется", async () => {
    process.env.CRON_SECRET = "s3cr3t-cron-key";

    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong-key" })).status).toBe(401);
    expect(sent).toHaveLength(0);
    expect(blobPuts).toHaveLength(0);
  });

  it("с верным секретом копия делается", async () => {
    process.env.CRON_SECRET = "s3cr3t-cron-key";
    const response = await call({ authorization: "Bearer s3cr3t-cron-key" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; rows: number };
    expect(body.ok).toBe(true);
    expect(body.rows).toBeGreaterThan(0);
  });
});

describe("шифрование и письмо", () => {
  it("без ключа копия во вложение НЕ уходит", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).encrypted).toBe(false);

    expect(sent).toHaveLength(1);
    // Незашифрованная копия — это адреса приглашённых и глоссарии в почте.
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].text).toContain("НЕ зашифрована");
    expect(sent[0].text).toContain("BACKUP_KEY");
  });

  it("с ключом уходит вложением и зашифрованной", async () => {
    process.env.BACKUP_KEY = Buffer.alloc(32, 9).toString("base64");
    const response = await call();

    expect((await response.json()).encrypted).toBe(true);
    expect(sent[0].attachments).toHaveLength(1);
    expect(sent[0].attachments![0].filename).toMatch(/\.json\.enc$/);

    // Содержимое вложения должно расшифровываться тем же ключом — иначе это
    // не копия, а набор байтов.
    const { decryptDump } = await import("@/lib/backup");
    const plain = decryptDump(
      sent[0].attachments![0].content,
      Buffer.from(process.env.BACKUP_KEY!, "base64"),
    );
    const dump = JSON.parse(plain.toString("utf8"));
    expect(dump.tables.some((t: { name: string }) => t.name === "users")).toBe(true);
  });

  it("негодный ключ останавливает копию и говорит об этом письмом", async () => {
    process.env.BACKUP_KEY = Buffer.alloc(16, 1).toString("base64");
    const response = await call();

    expect(response.status).toBe(500);
    expect(sent[0].subject).toContain("НЕ сделана");
    expect(sent[0].text).toContain("32 байта");
  });

  it("письмо называет таблицы и число строк", async () => {
    await call();
    expect(sent[0].text).toMatch(/Всего строк: \d+/);
    expect(sent[0].text).toContain("users:");
  });
});

describe("хранилище", () => {
  it("без токена Blob копия только в письме, и это сказано прямо", async () => {
    const response = await call();
    expect((await response.json()).stored).toBeNull();
    expect(blobPuts).toHaveLength(0);
    expect(sent[0].text).toContain("НЕ записана");
  });

  it("с токеном ложится в хранилище под датой", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "тестовый";
    const response = await call();

    expect((await response.json()).stored).toMatch(/^backups\//);
    expect(blobPuts).toHaveLength(1);
    expect(blobPuts[0]).toMatch(/^backups\/\d{4}-\d{2}-\d{2}/);
  });
});
