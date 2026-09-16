import { describe, expect, it } from "vitest";
import { commonOptions, scrub } from "@/lib/sentry-options";
import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Что уезжает к третьей стороне вместе с ошибкой.
 *
 * Трассировка ошибки — самое естественное место, куда утекут материалы
 * заказчиков: в теле запроса лежит текст документа, в локальных переменных
 * термины глоссария, в хлебных крошках значения полей формы. Собранная
 * «по умолчанию» ошибка уносит всё это к стороннему сервису, и обратно
 * оно уже не возвращается.
 *
 * Поэтому проверяется не «сбор работает», а «лишнее не уходит».
 */

const SECRET = "Высокоуровневая панель по гражданскому пространству";

const eventWith = (): ErrorEvent =>
  ({
    request: {
      url: `https://booth.growtomiddle.dev/projects/7?email=someone%40example.com`,
      method: "POST",
      data: { ssml: SECRET },
      cookies: { sync_trainer_session: "1.2.3" },
      headers: { authorization: "Bearer секрет", cookie: "sync_trainer_session=1.2.3" },
    },
    breadcrumbs: [{ message: `ввод: ${SECRET}`, category: "ui.input" }],
    exception: {
      values: [
        {
          type: "Error",
          value: "не удалось",
          stacktrace: {
            frames: [
              { filename: "route.ts", vars: { documentText: SECRET } },
              { filename: "prompt.ts", vars: { term: "гражданское пространство" } },
            ],
          },
        },
      ],
    },
  }) as unknown as ErrorEvent;

describe("вычистка события", () => {
  it("не оставляет ни тела запроса, ни заголовков, ни куки", () => {
    const event = scrub(eventWith())!;
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
  });

  it("срезает строку запроса, но оставляет путь", () => {
    // Путь нужен, чтобы понять, где упало. В строке запроса бывают адреса.
    const event = scrub(eventWith())!;
    expect(event.request?.url).toBe("https://booth.growtomiddle.dev/projects/7");
  });

  it("убирает локальные переменные из трассировки", () => {
    const event = scrub(eventWith())!;
    for (const value of event.exception?.values ?? []) {
      for (const frame of value.stacktrace?.frames ?? []) {
        expect(frame.vars).toBeUndefined();
      }
    }
  });

  it("убирает хлебные крошки целиком", () => {
    expect(scrub(eventWith())!.breadcrumbs).toBeUndefined();
  });

  it("никакого пользовательского текста в событии не остаётся", () => {
    // Сводная проверка: ищем нашу фразу во всём событии целиком.
    // Она валится, если добавится новое поле, о котором мы не подумали.
    const serialized = JSON.stringify(scrub(eventWith()));
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("гражданское пространство");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("sync_trainer_session");
  });

  it("сообщение об ошибке и место остаются — иначе чинить нечего", () => {
    const event = scrub(eventWith())!;
    expect(event.exception?.values?.[0].value).toBe("не удалось");
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe("route.ts");
  });
});

describe("настройки", () => {
  it("без ключа сбор выключен", () => {
    // Локально и в тестах ключа нет, и SDK обязан молчать, а не копить.
    expect(commonOptions.enabled).toBe(Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()));
  });

  it("личные данные не собираются, замеры скорости не включены", () => {
    expect(commonOptions.sendDefaultPii).toBe(false);
    // Замеры съедали бы бесплатный лимит, а скорость мы меряем иначе.
    expect(commonOptions.tracesSampleRate).toBe(0);
  });
});
