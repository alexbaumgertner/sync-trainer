import type { CollectionConfig } from "payload";
import {
  adminOnly,
  artifactStaysInProject,
  authenticated,
  isAdmin,
  ownedBy,
  ownedByProject,
  ownUsage,
  withinOwnProject,
} from "@/lib/access";
import { otpCookieStrategy } from "@/lib/payload-strategy";
import {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  inviteLink,
} from "@/lib/invite-token";
import { presetOptions, supportedLanguages } from "@/presets";
import { STEP_LABELS, STEPS } from "@/lib/activity-steps";
import { RATING_TARGETS, TARGET_LABELS } from "@/lib/ratings";
import { PROFILE_LANGS, VISIBLE_FIELDS } from "@/lib/profile";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  tr: "Türkçe",
};

// Языки и пресеты берутся из реестра: добавление пресета не требует правок здесь.
const SOURCE_LANGS = supportedLanguages().map((value) => ({
  label: LANGUAGE_LABELS[value] ?? value,
  value,
}));

export const Users: CollectionConfig = {
  slug: "users",
  /**
   * Паролей в системе нет вовсе.
   *
   * Локальная стратегия Payload отключена, остаётся одна — сессия, выданная
   * после кода на почту. Причин три, и все практические.
   *
   * Парольный вход был второй дверью в то же помещение, и худшей: наши
   * ограничители частоты и одинаковые ответы (A3, A4) живут в коде входа по
   * коду, а Payload про них не знает. Хеши паролей лежали в базе, а с T16 —
   * ещё и в каждой резервной копии. И пароль приходилось выдумывать случайный
   * при создании пользователя, потому что Payload его требовал: поле, которое
   * никому не нужно и никем не используется, — это мусор, который однажды
   * кто-нибудь примет за рабочий механизм.
   *
   * Запасной вход на случай отказа почты — `npm run session`: он требует
   * доступа к базе и AUTH_SECRET, то есть к серверу, а не к сети.
   */
  auth: { disableLocalStrategy: true, strategies: [otpCookieStrategy] },
  admin: { useAsTitle: "email", defaultColumns: ["email", "role", "createdAt"] },
  access: {
    /**
     * Кто вообще попадает в админку (Б4 аудита).
     *
     * Без этой функции Payload пускает в оболочку любого вошедшего. Данных
     * он постороннему не покажет — правила ниже работают, — но схему целиком
     * тот увидит, а вместе с ней удобный интерфейс для записи. До починки
     * Б1 это была ещё и готовая форма для записи в чужой проект.
     *
     * Проверка именно здесь, а не в `src/proxy.ts`: в куке лежит только
     * идентификатор, роли там нет, а ходить из прокси в базу на каждый
     * запрос — плата за то, что Payload проверит и сам.
     */
    admin: ({ req: { user } }) => isAdmin(user as never),
    read: ({ req: { user } }) =>
      user?.role === "admin" ? true : { id: { equals: user?.id } },
    create: adminOnly,
    update: ({ req: { user } }) =>
      user?.role === "admin" ? true : { id: { equals: user?.id } },
    delete: adminOnly,
  },
  fields: [
    /**
     * Адрес объявлен своим полем, а не взят у Payload.
     *
     * `disableLocalStrategy` уносит вместе с паролем все поля локальной
     * стратегии — включая `email`. А на нём держится всё: вход по коду,
     * приглашения, письма. Поэтому объявляем сами, с той же уникальностью,
     * что была: два пользователя с одним адресом сделали бы вход по коду
     * неоднозначным.
     */
    {
      name: "email",
      type: "email",
      required: true,
      unique: true,
      index: true,
    },
    {
      name: "role",
      type: "select",
      required: true,
      defaultValue: "interpreter",
      options: [
        { label: "Переводчик", value: "interpreter" },
        { label: "Администратор", value: "admin" },
      ],
      access: { update: ({ req: { user } }) => user?.role === "admin" },
    },
    {
      name: "uiLocale",
      type: "select",
      defaultValue: "ru",
      options: [
        { label: "Русский", value: "ru" },
        { label: "English", value: "en" },
      ],
    },
    { name: "displayName", type: "text", admin: { description: "P1: как вас зовут коллеги" } },

    /**
     * Профиль переводчика (P1).
     *
     * Живёт полями на пользователе, а не отдельной таблицей: связь один-к-одному
     * не даёт ничего, кроме лишнего запроса на каждой странице.
     */
    { name: "city", type: "text", admin: { description: "P1: где вы обычно работаете" } },
    {
      name: "bio",
      type: "textarea",
      admin: { description: "P1: свободный текст о себе" },
    },
    {
      name: "languagePairs",
      type: "array",
      admin: {
        description:
          "P1: направленные пары. EN→RU и RU→EN — разные строки: перевод в кабину " +
          "и retour это разная работа и разная ставка",
      },
      fields: [
        { name: "source", type: "select", required: true, options: PROFILE_LANGS },
        { name: "target", type: "select", required: true, options: PROFILE_LANGS },
      ],
    },
    {
      name: "specializations",
      type: "array",
      admin: { description: "P1: права человека, климат, медицина, право" },
      fields: [{ name: "name", type: "text", required: true }],
    },
    {
      name: "memberships",
      type: "array",
      admin: { description: "P1: AIIC, национальные объединения" },
      fields: [{ name: "name", type: "text", required: true }],
    },

    /**
     * Что из профиля видно коллегам (P3).
     *
     * Имя в список не входит намеренно: карточка без имени — не карточка,
     * а скрыть себя целиком можно, просто не заполняя профиль.
     *
     * Показываем только то, что владелец разрешил явно: значение по умолчанию
     * `false`. Обратный порядок — «скрыто, пока не запретил» — однажды
     * покажет коллегам поле, о котором человек не знал, что оно появилось.
     */
    {
      name: "visibility",
      type: "group",
      fields: VISIBLE_FIELDS.map((name) => ({
        name,
        type: "checkbox" as const,
        defaultValue: false,
      })),
    },

    { name: "invitedAt", type: "date", admin: { readOnly: true } },
    {
      name: "monthlyLimitUsd",
      type: "number",
      admin: { description: "Пусто — берётся общий лимит из окружения (B2)" },
      access: { update: ({ req: { user } }) => user?.role === "admin" },
    },
  ],
};

/** A5: доступ по персональному приглашению, а не по статическому списку адресов. */
export const Invitations: CollectionConfig = {
  slug: "invitations",
  admin: { useAsTitle: "email", defaultColumns: ["email", "acceptedAt", "expiresAt"] },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  hooks: {
    // Токен выписывается здесь, а не в коде вызова: тогда приглашение работает
    // одинаково и из админки, и из скрипта. Сырой токен живёт ровно до отправки
    // письма и нигде не сохраняется — в базе только хеш.
    beforeValidate: [
      ({ req, operation, data }) => {
        if (operation !== "create" || !data) return data;

        // Токен может прийти из кода через context — тогда вызывающий знает
        // ссылку и может её показать. Из админки его здесь и выписываем.
        const context = req.context as Record<string, unknown>;
        const token =
          typeof context.inviteToken === "string" ? context.inviteToken : generateInviteToken();
        context.inviteToken = token;

        return {
          ...data,
          email: String(data.email ?? "").trim().toLowerCase(),
          tokenHash: hashInviteToken(token),
          expiresAt: data.expiresAt ?? new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          invitedBy: data.invitedBy ?? req.user?.id,
        };
      },
    ],
    afterChange: [
      async ({ req, operation, doc }) => {
        if (operation !== "create") return doc;
        const token = (req.context as Record<string, unknown>).inviteToken;
        if (typeof token !== "string") return doc;

        // Динамический импорт: модуль почты помечен server-only, а конфигурация
        // коллекций читается в том числе вне контекста запроса.
        const { sendEmail, inviteEmail } = await import("@/lib/email");
        try {
          await sendEmail({ to: doc.email, ...inviteEmail(inviteLink(token), doc.note) });
        } catch (error) {
          // Приглашение уже создано; непосланное письмо не повод терять запись.
          req.payload.logger.error({ err: error }, "не удалось отправить приглашение");
        }
        return doc;
      },
    ],
  },
  fields: [
    { name: "email", type: "email", required: true, index: true },
    {
      name: "tokenHash",
      type: "text",
      index: true,
      admin: { readOnly: true, description: "Хеш токена. Сам токен есть только в письме" },
    },
    {
      name: "expiresAt",
      type: "date",
      admin: { description: "Пусто — две недели от создания" },
    },
    { name: "acceptedAt", type: "date", admin: { readOnly: true } },
    { name: "acceptedBy", type: "relationship", relationTo: "users", admin: { readOnly: true } },
    { name: "invitedBy", type: "relationship", relationTo: "users" },
    { name: "note", type: "text" },
  ],
};

export const Projects: CollectionConfig = {
  slug: "projects",
  admin: { useAsTitle: "title", defaultColumns: ["title", "eventName", "sourceLang", "status"] },
  access: {
    read: ownedBy("owner"),
    update: ownedBy("owner"),
    delete: ownedBy("owner"),
    create: authenticated,
  },
  hooks: {
    // F4: удаление проекта уносит файлы и связанные записи.
    //
    // Каскад обязателен и обязан идти ДО удаления самого проекта: у внешних
    // ключей стоит SET NULL, а колонка project_id объявлена NOT NULL, поэтому
    // проект с любым артефактом иначе не удаляется вовсе — база отклоняет
    // операцию. Заодно здесь же собираем пути к файлам: после удаления строк
    // взять их уже негде.
    beforeDelete: [
      async ({ req, id }) => {
        const artifacts = await req.payload.find({
          collection: "artifacts",
          where: { project: { equals: id } },
          limit: 1000,
          depth: 0,
          overrideAccess: true,
        });
        (req.context as Record<string, unknown>).artifactPaths = artifacts.docs
          .map((doc) => doc.blobPath)
          .filter(Boolean);

        // Список обязан покрывать КАЖДУЮ коллекцию с обязательной связью
        // на проект. Забыть одну — значит сделать проект неудаляемым, и
        // узнается это на первом же человеке, который решил прибраться.
        // Полноту списка стережёт тест `project-cascade`.
        //
        // `activity` здесь намеренно нет: связь с проектом там необязательная,
        // `SET NULL` ложится, и шаги воронки переживают удаление проекта —
        // «сколько проектов дошло до озвучки» не должно меняться задним числом.
        for (const collection of [
          "ratings",
          "artifacts",
          "documents",
          "generations",
          "glossary-terms",
          "debriefs",
        ] as const) {
          await req.payload
            .delete({ collection, where: { project: { equals: id } }, overrideAccess: true })
            .catch((error: unknown) => {
              req.payload.logger.error({ err: error, collection }, "каскадное удаление не удалось");
            });
        }
      },
    ],
    afterDelete: [
      async ({ req, id }) => {
        const paths = (req.context as Record<string, unknown>).artifactPaths;
        const { deleteArtifacts, deleteProjectFolder } = await import("@/lib/artifacts");
        try {
          if (Array.isArray(paths) && paths.length) await deleteArtifacts(paths as string[]);
          await deleteProjectFolder(Number(id));
        } catch (error) {
          // Строки уже удалены; недоступный файл не повод оставлять проект.
          req.payload.logger.error({ err: error }, "не удалось удалить файлы проекта");
        }
      },
    ],
    beforeChange: [
      ({ req, operation, data }) => {
        if (operation !== "create") return data;
        // Серверный вызов без сессии (overrideAccess) — владелец берётся из данных.
        if (!req.user) return data;
        // Администратор может завести проект на другого; обычный пользователь —
        // только на себя, поэтому владелец берётся из сессии, а не из тела запроса.
        if (req.user.role === "admin") return { ...data, owner: data.owner ?? req.user.id };
        return { ...data, owner: req.user.id };
      },
    ],
  },
  fields: [
    { name: "title", type: "text", required: true },
    {
      name: "owner",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    { name: "eventName", type: "text" },
    { name: "eventStartsOn", type: "date" },
    { name: "eventLocation", type: "text" },
    {
      name: "debriefRemindedAt",
      type: "date",
      admin: {
        readOnly: true,
        description: "E5: когда напомнили о разборе. Напоминаем один раз",
      },
    },
    {
      name: "sourceLang",
      type: "select",
      required: true,
      defaultValue: "en",
      options: SOURCE_LANGS,
    },
    {
      name: "targetLang",
      type: "select",
      required: true,
      defaultValue: "ru",
      options: [
        { label: "Русский", value: "ru" },
        { label: "English", value: "en" },
      ],
    },
    {
      name: "stylePreset",
      type: "select",
      required: true,
      defaultValue: "un",
      options: presetOptions(),
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "draft",
      options: [
        { label: "Черновик", value: "draft" },
        { label: "Скрипт готов", value: "scripted" },
        { label: "Аудио готово", value: "ready" },
        { label: "Событие прошло", value: "held" },
      ],
    },
  ],
};

/**
 * F1–F2: оригинал документа удаляется после обработки, здесь остаются только
 * метаданные. Содержимого документа в этой коллекции нет и быть не должно.
 */
export const Documents: CollectionConfig = {
  slug: "documents",
  admin: { useAsTitle: "filename", defaultColumns: ["filename", "project", "purgedAt"] },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Доступ на создание у Payload отвечает только «да/нет» и содержимого
    // не видит. Владельца проекта проверяет `withinOwnProject` ниже.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    { name: "filename", type: "text", required: true },
    { name: "mime", type: "text" },
    { name: "bytes", type: "number" },
    { name: "sha256", type: "text" },
    { name: "pages", type: "number" },
    {
      name: "extractedChars",
      type: "number",
      admin: { description: "Длина извлечённого текста. Сам текст не сохраняется (F2)" },
    },
    {
      name: "purgedAt",
      type: "date",
      admin: { description: "Момент удаления оригинала из хранилища (F1)" },
    },
  ],
};

export const Generations: CollectionConfig = {
  slug: "generations",
  admin: { useAsTitle: "kind", defaultColumns: ["kind", "project", "status", "costUsd"] },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Доступ на создание у Payload отвечает только «да/нет» и содержимого
    // не видит. Владельца проекта проверяет `withinOwnProject` ниже.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    {
      name: "kind",
      type: "select",
      required: true,
      options: [
        { label: "Скрипт", value: "script" },
        { label: "Аудио", value: "audio" },
      ],
    },
    { name: "params", type: "json" },
    { name: "model", type: "text" },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "queued",
      options: [
        { label: "В очереди", value: "queued" },
        { label: "Выполняется", value: "running" },
        { label: "Готово", value: "done" },
        { label: "Ошибка", value: "failed" },
      ],
    },
    { name: "error", type: "text" },
    { name: "chars", type: "number" },
    { name: "costUsd", type: "number" },
  ],
};

export const Artifacts: CollectionConfig = {
  slug: "artifacts",
  admin: { useAsTitle: "kind", defaultColumns: ["kind", "project", "bytes"] },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Доступ на создание у Payload отвечает только «да/нет» и содержимого
    // не видит. Владельца проекта проверяет `withinOwnProject` ниже.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject, artifactStaysInProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    { name: "generation", type: "relationship", relationTo: "generations" },
    {
      name: "kind",
      type: "select",
      required: true,
      options: [
        { label: "Скрипт", value: "script" },
        { label: "SSML", value: "ssml" },
        { label: "Аудио MP3", value: "audio" },
        { label: "Глоссарий CSV", value: "glossary" },
      ],
    },
    { name: "blobPath", type: "text", required: true },
    { name: "bytes", type: "number" },
  ],
};

/** D3: происхождение термина хранится с самого начала, до появления интерфейса ревью. */
export const GlossaryTerms: CollectionConfig = {
  slug: "glossary-terms",
  admin: {
    useAsTitle: "sourceTerm",
    defaultColumns: ["sourceTerm", "targetTerm", "status", "occurredAtEvent"],
  },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Доступ на создание у Payload отвечает только «да/нет» и содержимого
    // не видит. Владельца проекта проверяет `withinOwnProject` ниже.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    { name: "sourceTerm", type: "text", required: true },
    { name: "targetTerm", type: "text" },
    { name: "note", type: "textarea" },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "suggested",
      options: [
        { label: "Предложен моделью", value: "suggested" },
        { label: "Подтверждён человеком", value: "verified" },
        { label: "Из практики", value: "from-practice" },
      ],
    },
    { name: "proposedBy", type: "relationship", relationTo: "users" },
    { name: "verifiedBy", type: "relationship", relationTo: "users" },
    { name: "verifiedAt", type: "date" },
    {
      name: "occurredAtEvent",
      type: "checkbox",
      defaultValue: false,
      admin: { description: "E1: термин действительно прозвучал на событии" },
    },
  ],
};

export const Debriefs: CollectionConfig = {
  slug: "debriefs",
  admin: { useAsTitle: "heldOn", defaultColumns: ["project", "heldOn", "actualPace"] },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Доступ на создание у Payload отвечает только «да/нет» и содержимого
    // не видит. Владельца проекта проверяет `withinOwnProject` ниже.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    { name: "heldOn", type: "date" },
    {
      name: "hardest",
      type: "textarea",
      admin: { description: "E3: что было труднее всего — из этого растёт следующая подготовка" },
    },
    { name: "missingTerms", type: "textarea", admin: { description: "E2: чего не хватило" } },
    {
      name: "surprises",
      type: "textarea",
      admin: { description: "E3: чем событие разошлось с ожиданием" },
    },
    {
      name: "actualPace",
      type: "select",
      options: [
        { label: "Медленнее ожидаемого", value: "slower" },
        { label: "Как ожидалось", value: "as-expected" },
        { label: "Быстрее ожидаемого", value: "faster" },
        { label: "Гораздо быстрее", value: "much-faster" },
      ],
    },
  ],
};

/** B1: расход привязан к пользователю и проекту. Пишет только сервер. */
export const UsageEvents: CollectionConfig = {
  slug: "usage-events",
  admin: { useAsTitle: "kind", defaultColumns: ["user", "project", "kind", "costUsd", "createdAt"] },
  access: {
    read: ownUsage,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    // Необязателен по той же причине, что и в `activity`: `SET NULL` на
    // `NOT NULL` не ложится. Здесь это к тому же сохраняет историю расходов —
    // общий лимит сервиса считается по ней, и обнулять его с уходом человека
    // было бы неверно. Поломка тут давняя, просто не срабатывала: записи
    // появляются только при платной генерации, а `activity` пишется всегда.
    { name: "user", type: "relationship", relationTo: "users", index: true },
    { name: "project", type: "relationship", relationTo: "projects", index: true },
    {
      name: "kind",
      type: "select",
      required: true,
      options: [
        { label: "Скрипт", value: "script" },
        { label: "Аудио", value: "audio" },
      ],
    },
    { name: "chars", type: "number", required: true },
    { name: "costUsd", type: "number", required: true },
    { name: "tier", type: "text" },
    { name: "voices", type: "json" },
  ],
};

/**
 * A1–A3: одноразовые коды. Хранится только хеш — по содержимому базы войти нельзя.
 * Пишет и читает эту коллекцию исключительно сервер, поэтому доступ закрыт всем,
 * кроме администратора: в UI она не нужна, а в админке полезна при разборе жалоб.
 */
export const OtpCodes: CollectionConfig = {
  slug: "otp-codes",
  admin: { useAsTitle: "email", defaultColumns: ["email", "expiresAt", "attempts", "consumedAt"] },
  access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: "email", type: "email", required: true, index: true },
    { name: "codeHash", type: "text", required: true },
    { name: "expiresAt", type: "date", required: true, index: true },
    { name: "attempts", type: "number", required: true, defaultValue: 0 },
    { name: "consumedAt", type: "date" },
    {
      name: "requestIp",
      type: "text",
      index: true,
      admin: { description: "Для ограничения частоты по адресу (A3)" },
    },
    {
      name: "delivered",
      type: "checkbox",
      defaultValue: false,
      admin: { description: "Письмо отправлено. Для неприглашённых адресов остаётся false (A4)" },
    },
  ],
};

/**
 * Продуктовая воронка (слой 2 метрик).
 *
 * Отдельно от `usage-events`: там расход денег на Google, по записи на
 * обращение. Здесь — шаги пользователя, в том числе бесплатные, и вопросы
 * к ним другие: сколько проектов доходит от документа до озвучки, сколько
 * разборов заполняется, сколько приглашений превращается в учётные записи.
 *
 * Свободного текста тут нет и не будет: `step` — перечисление. Причина
 * в `src/lib/activity-steps.ts`, и она не про аккуратность, а про NDA
 * заказчиков.
 *
 * Записи копятся без срока: истории и нужна история. Если таблица начнёт
 * весить заметно, резать её надо по возрасту, а не отключать запись.
 */
export const Activity: CollectionConfig = {
  slug: "activity",
  admin: { useAsTitle: "step", defaultColumns: ["step", "user", "project", "createdAt"] },
  access: {
    // Воронку смотрит владелец продукта. Пользователю она не показывается
    // нигде, и давать читать чужие шаги незачем.
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    /**
     * Пользователь необязателен НАМЕРЕННО, хотя пишем мы всегда с ним.
     *
     * У внешнего ключа стоит `ON DELETE SET NULL`. С `required: true`
     * колонка выходит `NOT NULL`, и удаление пользователя падает на первой
     * же его записи — то есть человека, попросившего себя удалить, удалить
     * нельзя. Поймано сквозным тестом; ни один модульный не заметил,
     * потому что чистил за собой в правильном порядке.
     *
     * Обнуление здесь лучше каскадного удаления: воронка отвечает на вопрос
     * «сколько проектов дошло до озвучки», и ответ не должен меняться задним
     * числом оттого, что кто-то ушёл. Связь с человеком при этом рвётся —
     * для ушедшего это ровно то, что нужно.
     */
    { name: "user", type: "relationship", relationTo: "users", index: true },
    { name: "project", type: "relationship", relationTo: "projects", index: true },
    {
      name: "step",
      type: "select",
      required: true,
      index: true,
      options: STEPS.map((value) => ({ label: STEP_LABELS[value], value })),
    },
  ],
};

/**
 * Оценка сгенерированного материала (обратная связь о качестве).
 *
 * Привязана к ГЕНЕРАЦИИ, а не к проекту: перегенерировали — это другой
 * материал, и прежняя оценка остаётся при том, что её заслужила. Иначе
 * «годится» переезжало бы на файл, которого оценивавший не слышал.
 *
 * Свободная заметка здесь, в отличие от `activity`, разрешена: это данные
 * проекта, видит их только владелец, и пишет он о собственной озвучке.
 * Правило «без текста» касалось метрик, которые смотрит владелец сервиса.
 * Заметки к тому же нужны по делу: список причин «чем плохо» придумывать
 * заранее не из чего, а из них он и вырастет.
 */
export const Ratings: CollectionConfig = {
  slug: "ratings",
  admin: {
    useAsTitle: "target",
    defaultColumns: ["target", "score", "project", "createdAt"],
  },
  access: {
    read: ownedByProject,
    update: ownedByProject,
    delete: ownedByProject,
    // Как и у прочих дочерних: `Where` на создании Payload не применяет,
    // владельца проверяет `withinOwnProject`.
    create: authenticated,
  },
  hooks: { beforeChange: [withinOwnProject] },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    {
      name: "generation",
      type: "relationship",
      relationTo: "generations",
      index: true,
      admin: { description: "Какой именно вывод оценили" },
    },
    // Необязателен по той же причине, что в `activity`: `SET NULL`
    // не ложится на `NOT NULL`, и ушедшего пользователя было бы не удалить.
    { name: "user", type: "relationship", relationTo: "users", index: true },
    {
      name: "target",
      type: "select",
      required: true,
      index: true,
      options: RATING_TARGETS.map((value) => ({ label: TARGET_LABELS[value], value })),
    },
    {
      name: "score",
      type: "number",
      required: true,
      min: 1,
      max: 3,
      admin: { description: "1 не годится · 2 сойдёт с оговорками · 3 годится как есть" },
    },
    {
      name: "note",
      type: "textarea",
      admin: { description: "Чем именно плохо или хорошо. Необязательно" },
    },
  ],
};

/**
 * Запись о проведённой работе (W1–W5).
 *
 * Не разбор. Разбор (`debriefs`) приватен и честен именно поэтому: там пишут,
 * где сбились. Здесь — профессиональный след: что за событие, кто заказчик,
 * кто выступал, как прошло. Смешать их значило бы заставить писать разбор
 * с оглядкой, а осторожный разбор бесполезен для подготовки.
 *
 * Связь с проектом необязательная (W2). У переводчика годы конференций до
 * тренажёра, и требовать проект — значит оставить профиль пустым в первый
 * день, когда заполнять его и есть смысл.
 */
const Engagements: CollectionConfig = {
  slug: "engagements",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "organizer", "heldOn", "mode"],
  },
  access: {
    read: ownedBy("owner"),
    update: ownedBy("owner"),
    delete: ownedBy("owner"),
    create: authenticated,
  },
  hooks: {
    beforeChange: [
      ({ req, operation, data }) => {
        if (operation !== "create") return data;
        if (!req.user) return data;
        // Как и у проектов: администратор может завести запись на другого,
        // обычный пользователь — только на себя.
        if (req.user.role === "admin") return { ...data, owner: data.owner ?? req.user.id };
        return { ...data, owner: req.user.id };
      },
    ],
  },
  fields: [
    {
      name: "owner",
      type: "relationship",
      relationTo: "users",
      required: true,
      index: true,
    },
    {
      name: "project",
      type: "relationship",
      relationTo: "projects",
      // W2: необязательная. Запись может быть о конференции, которой
      // в тренажёре никогда не было.
      index: true,
    },
    { name: "title", type: "text", required: true },
    { name: "organizer", type: "text", admin: { description: "W1: кто заказчик" } },
    { name: "heldOn", type: "date", required: true },
    { name: "location", type: "text" },
    {
      name: "mode",
      type: "select",
      required: true,
      defaultValue: "simultaneous",
      options: [
        { label: "Синхронный", value: "simultaneous" },
        { label: "Удалённый синхронный", value: "rsi" },
        { label: "Последовательный", value: "consecutive" },
        { label: "Шушутаж", value: "whispered" },
      ],
    },
    { name: "sourceLang", type: "select", required: true, options: [...PROFILE_LANGS] },
    { name: "targetLang", type: "select", required: true, options: [...PROFILE_LANGS] },
    {
      name: "wentHow",
      type: "number",
      min: 1,
      max: 5,
      admin: { description: "W5: как прошло, 1–5" },
    },
    {
      name: "wentText",
      type: "textarea",
      admin: {
        description:
          "W5: не разбор. Сюда пишут то, что не стыдно показать команде",
      },
    },
    {
      name: "speakers",
      type: "array",
      admin: {
        description:
          "W4: только текст. Спикеры не пользователи сервиса, их согласия у нас нет",
      },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "organization", type: "text" },
      ],
    },
    {
      name: "visibility",
      type: "select",
      required: true,
      defaultValue: "team",
      options: [
        { label: "Только я", value: "private" },
        { label: "Я и команда события", value: "team" },
      ],
      admin: {
        description:
          "W6. Уровень «заказчику» добавится сюда, когда появится сторона заказчика",
      },
    },

    /**
     * Команда события (W3).
     *
     * Имя — всегда, связь с учётной записью — если адрес совпал. Такой порядок
     * позволяет записать команду сразу, не дожидаясь, пока коллеги заведутся
     * в сервисе, и дорастить связь потом.
     *
     * `status` заложен под R2-4 целиком, чтобы подтверждение не потребовало
     * второй миграции. Пока запись создаётся со `listed`: «назван, но никем
     * не подтверждён» — и показывать её надо именно так (C2).
     */
    {
      name: "team",
      type: "array",
      admin: { description: "W3: кто ещё переводил" },
      fields: [
        { name: "name", type: "text", required: true },
        {
          name: "email",
          type: "email",
          admin: { description: "По нему связываем с учётной записью" },
        },
        {
          name: "user",
          type: "relationship",
          relationTo: "users",
          index: true,
          admin: { description: "Связь появляется, когда адрес совпал" },
        },
        { name: "booth", type: "text", admin: { description: "Кабина или роль" } },
        {
          name: "status",
          type: "select",
          required: true,
          defaultValue: "listed",
          options: [
            { label: "Назван", value: "listed" },
            { label: "Приглашён", value: "invited" },
            { label: "Напомнили", value: "reminded" },
            { label: "Подтвердил", value: "confirmed" },
            { label: "Оспорил", value: "disputed" },
            { label: "Отозвал согласие", value: "withdrawn" },
          ],
        },
        { name: "confirmedAt", type: "date", admin: { readOnly: true } },
        { name: "note", type: "text" },
      ],
    },
  ],
};

export const collections: CollectionConfig[] = [
  Users,
  Invitations,
  OtpCodes,
  Projects,
  Documents,
  Generations,
  Artifacts,
  GlossaryTerms,
  Debriefs,
  Engagements,
  UsageEvents,
  Activity,
  Ratings,
];
