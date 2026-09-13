import type { CollectionConfig } from "payload";
import { adminOnly, authenticated, ownedBy, ownedByProject, ownUsage } from "@/lib/access";
import { otpCookieStrategy } from "@/lib/payload-strategy";
import {
  INVITE_TTL_MS,
  generateInviteToken,
  hashInviteToken,
  inviteLink,
} from "@/lib/invite-token";

const SOURCE_LANGS = [
  { label: "English", value: "en" },
  { label: "Deutsch", value: "de" },
  { label: "Français", value: "fr" },
  { label: "Türkçe", value: "tr" },
];

export const Users: CollectionConfig = {
  slug: "users",
  // Две стратегии на одной коллекции: локальная — вход в админку по паролю,
  // otp-cookie — сессия приложения, выданная после кода на почту. Благодаря
  // второй права доступа из коллекций применяются к запросам приложения сами.
  auth: { strategies: [otpCookieStrategy] },
  admin: { useAsTitle: "email", defaultColumns: ["email", "role", "createdAt"] },
  access: {
    read: ({ req: { user } }) =>
      user?.role === "admin" ? true : { id: { equals: user?.id } },
    create: adminOnly,
    update: ({ req: { user } }) =>
      user?.role === "admin" ? true : { id: { equals: user?.id } },
    delete: adminOnly,
  },
  fields: [
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
    { name: "displayName", type: "text" },
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
      options: [
        { label: "ООН", value: "un" },
        { label: "Суд и Гаага", value: "court" },
        { label: "Институты ЕС", value: "eu" },
        { label: "Корпоративная конференция", value: "corporate" },
      ],
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
    create: authenticated,
  },
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
    create: authenticated,
  },
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
    create: authenticated,
  },
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
    create: authenticated,
  },
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
    create: authenticated,
  },
  fields: [
    { name: "project", type: "relationship", relationTo: "projects", required: true, index: true },
    { name: "heldOn", type: "date" },
    { name: "wentWell", type: "textarea" },
    { name: "missingTerms", type: "textarea", admin: { description: "E2: чего не хватило" } },
    { name: "surprises", type: "textarea" },
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
    { name: "user", type: "relationship", relationTo: "users", required: true, index: true },
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
  UsageEvents,
];
