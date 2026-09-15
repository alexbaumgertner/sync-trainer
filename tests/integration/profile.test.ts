import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Профиль переводчика (P1–P3).
 *
 * Главное здесь — не форма, а что уходит наружу. Проверка построена вокруг
 * одного: **скрытое не должно оказаться у коллеги ни при каких условиях**,
 * и новое поле пользователя не должно уехать к нему само.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    const error = new Error(`REDIRECT:${to}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;${to}`;
    throw error;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { profileView, profileIsEmpty, pairLabel, VISIBLE_FIELDS } = await import("@/lib/profile");
const { saveProfile } = await import("@/app/(frontend)/profile/actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let colleague: number;

const form = (entries: Record<string, string | string[]>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};

const save = async (data: FormData): Promise<string> => {
  try {
    await saveProfile(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const load = (id: number) =>
  payload.findByID({ collection: "users", id, depth: 0, overrideAccess: true });

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `pf-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;

  owner = await makeUser("owner");
  colleague = await makeUser("colleague");
  sessionToken = issueToken(owner).token;
});

beforeEach(() => {
  sessionToken = issueToken(owner).token;
});

afterAll(async () => {
  for (const id of [owner, colleague]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("сохранение профиля", () => {
  it("записывает имя, город, пары, специализации и объединения", async () => {
    expect(
      await save(
        form({
          displayName: "  Анна Иванова  ",
          city: "Женева",
          bio: "Работаю с 2014 года.",
          pairSource: ["en", "ru", "de"],
          pairTarget: ["ru", "en", "ru"],
          specializations: "права человека\n климат \n\nправа человека",
          memberships: "- AIIC\n• Национальная ассоциация",
        }),
      ),
    ).toBe("/profile?saved=1");

    const me = await load(owner);
    expect(me.displayName).toBe("Анна Иванова");
    expect(me.city).toBe("Женева");
    expect(me.languagePairs).toHaveLength(3);
    // Повтор отброшен, маркеры списка сняты.
    expect(me.specializations?.map((s) => s.name)).toEqual(["права человека", "климат"]);
    expect(me.memberships?.map((m) => m.name)).toEqual(["AIIC", "Национальная ассоциация"]);
  });

  it("направление сохраняется: EN→RU и RU→EN — разные строки", async () => {
    await save(
      form({ displayName: "Анна", pairSource: ["en", "ru"], pairTarget: ["ru", "en"] }),
    );

    const pairs = (await load(owner)).languagePairs ?? [];
    expect(pairs.map((p) => `${p.source}>${p.target}`)).toEqual(["en>ru", "ru>en"]);
  });

  it("одна и та же пара дважды не сохраняется", async () => {
    await save(
      form({ displayName: "Анна", pairSource: ["en", "en"], pairTarget: ["ru", "ru"] }),
    );
    expect((await load(owner)).languagePairs).toHaveLength(1);
  });

  it("недоделанная пара выбрасывается, а не сохраняется половиной", async () => {
    await save(form({ displayName: "Анна", pairSource: ["en", "de"], pairTarget: ["ru", ""] }));
    expect((await load(owner)).languagePairs).toHaveLength(1);
  });

  it("незнакомый язык не проходит", async () => {
    await save(form({ displayName: "Анна", pairSource: ["klingon"], pairTarget: ["ru"] }));
    expect((await load(owner)).languagePairs ?? []).toHaveLength(0);
  });
});

describe("видимость", () => {
  const fill = () =>
    save(
      form({
        displayName: "Анна Иванова",
        city: "Женева",
        bio: "О себе",
        pairSource: ["en"],
        pairTarget: ["ru"],
        specializations: "климат",
        memberships: "AIIC",
      }),
    );

  it("по умолчанию коллеге не видно ничего, кроме имени", async () => {
    await fill();
    const view = profileView(await load(owner), colleague);

    expect(view.displayName).toBe("Анна Иванова");
    expect(view.own).toBe(false);
    expect(view.city).toBeNull();
    expect(view.bio).toBeNull();
    expect(view.languagePairs).toEqual([]);
    expect(view.specializations).toEqual([]);
    expect(view.memberships).toEqual([]);
    expect(profileIsEmpty(view)).toBe(true);
  });

  it("владелец видит своё целиком, даже когда всё скрыто", async () => {
    await fill();
    const view = profileView(await load(owner), owner);

    expect(view.own).toBe(true);
    expect(view.city).toBe("Женева");
    expect(view.languagePairs).toHaveLength(1);
  });

  it("открытое поле видно, соседние — нет", async () => {
    await fill();
    await save(
      form({
        displayName: "Анна Иванова",
        city: "Женева",
        bio: "О себе",
        pairSource: ["en"],
        pairTarget: ["ru"],
        specializations: "климат",
        memberships: "AIIC",
        visible_languagePairs: "on",
        visible_city: "on",
      }),
    );

    const view = profileView(await load(owner), colleague);
    expect(view.languagePairs).toHaveLength(1);
    expect(view.city).toBe("Женева");
    // Открыли два поля — остальные остались закрытыми.
    expect(view.bio).toBeNull();
    expect(view.specializations).toEqual([]);
    expect(view.memberships).toEqual([]);
  });

  it("снятая галочка снова закрывает поле", async () => {
    await save(
      form({ displayName: "Анна", city: "Женева", visible_city: "on" }),
    );
    expect(profileView(await load(owner), colleague).city).toBe("Женева");

    await save(form({ displayName: "Анна", city: "Женева" }));
    expect(profileView(await load(owner), colleague).city).toBeNull();
  });
});

describe("что уходит наружу", () => {
  it("в карточке нет ничего, кроме перечисленного — ни почты, ни лимитов", async () => {
    await save(form({ displayName: "Анна", city: "Женева", visible_city: "on" }));

    const view = profileView(await load(owner), colleague);
    const allowed = ["id", "displayName", "own", "city", "bio", "languagePairs", "specializations", "memberships"];

    // Список полей проверяется целиком: новое поле пользователя не должно
    // появиться здесь само, а списком исключений это не поймать.
    expect(Object.keys(view).sort()).toEqual(allowed.sort());
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("@example.test");
    expect(serialized).not.toContain("monthlyLimit");
    expect(serialized).not.toContain("role");
  });

  it("все скрываемые поля учтены в карточке", () => {
    // Иначе поле можно скрыть в интерфейсе, а оно всё равно не показывается —
    // или, хуже, показывается всегда.
    const view = profileView(
      { id: 1, displayName: "x", email: "x@y.z", role: "interpreter" } as never,
      2,
    );
    for (const field of VISIBLE_FIELDS) {
      expect(Object.keys(view)).toContain(field);
    }
  });
});

describe("подписи", () => {
  it("пара показывается направлением, а не парой языков", () => {
    expect(pairLabel({ source: "en", target: "ru" })).toBe("English → Русский");
    expect(pairLabel({ source: "ru", target: "en" })).toBe("Русский → English");
  });

  it("незнакомый код не ломает подпись", () => {
    expect(pairLabel({ source: "xx", target: "ru" })).toBe("xx → Русский");
  });
});
