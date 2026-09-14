import { afterEach, describe, expect, it } from "vitest";

const { inviteLink } = await import("@/lib/invite-token");

const KEYS = ["APP_URL", "VERCEL_ENV", "VERCEL_BRANCH_URL", "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const setEnv = (values: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key]!;
  }
});

describe("адрес в ссылке-приглашении", () => {
  it("на стенде ведёт на стенд, а не в продакшен", () => {
    setEnv({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "sync-trainer-git-feat-r1.vercel.app",
      VERCEL_URL: "sync-trainer-abc123.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "sync-trainer.vercel.app",
    });
    expect(inviteLink("t0ken")).toBe(
      "https://sync-trainer-git-feat-r1.vercel.app/invite/t0ken",
    );
  });

  it("в продакшене ведёт на боевой адрес", () => {
    setEnv({
      VERCEL_ENV: "production",
      VERCEL_URL: "sync-trainer-xyz789.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "sync-trainer.vercel.app",
    });
    expect(inviteLink("t0ken")).toBe("https://sync-trainer.vercel.app/invite/t0ken");
  });

  it("APP_URL перекрывает всё и теряет хвостовой слэш", () => {
    setEnv({
      APP_URL: "https://trainer.example/",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "sync-trainer.vercel.app",
    });
    expect(inviteLink("t0ken")).toBe("https://trainer.example/invite/t0ken");
  });

  it("без переменных остаётся локальный адрес разработки", () => {
    setEnv({});
    expect(inviteLink("t0ken")).toBe("http://localhost:3000/invite/t0ken");
  });
});
