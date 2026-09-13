// Без пометки server-only намеренно: модуль используют и маршруты Next,
// и скрипты обслуживания, которые исполняются вне Next. В клиентский код он
// не попадёт — тянет за собой Payload и доступ к базе.
import crypto from "node:crypto";
import { payloadClient } from "./payload";
import { codeEmail, sendEmail } from "./email";

/**
 * Одноразовые коды входа (A1–A4).
 *
 * Ограничители частоты живут в базе, а не в памяти процесса: в serverless
 * инстансов много, и счётчик в памяти почти ничего не ограничивает.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PER_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL_LIMIT = 3;
const PER_IP_WINDOW_MS = 60 * 60 * 1000;
const PER_IP_LIMIT = 20;

/** A4: ответ не должен выдавать, знаком ли адрес, ни текстом, ни временем. */
const MIN_RESPONSE_MS = 400;

export const TOO_MANY = "Слишком много попыток. Попробуйте позже.";
export const BAD_CODE = "Код неверный или истёк.";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function hashCode(email: string, code: string): string {
  const key = process.env.AUTH_SECRET?.trim() || process.env.PAYLOAD_SECRET?.trim() || "";
  return crypto.createHmac("sha256", key).update(`${normalizeEmail(email)}:${code}`).digest("hex");
}

async function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const [result] = await Promise.all([work, new Promise((r) => setTimeout(r, ms))]);
  return result;
}

/** Пускаем только приглашённых (A5): либо пользователь уже есть, либо есть живое приглашение. */
async function mayReceiveCode(email: string): Promise<boolean> {
  const payload = await payloadClient();
  const normalized = normalizeEmail(email);

  const users = await payload.find({
    collection: "users",
    where: { email: { equals: normalized } },
    limit: 1,
    overrideAccess: true,
  });
  if (users.totalDocs > 0) return true;

  const invites = await payload.find({
    collection: "invitations",
    where: {
      and: [
        { email: { equals: normalized } },
        { acceptedAt: { exists: false } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  });
  return invites.totalDocs > 0;
}

async function overRateLimit(email: string, ip: string): Promise<boolean> {
  const payload = await payloadClient();
  const now = Date.now();

  const byEmail = await payload.count({
    collection: "otp-codes",
    where: {
      and: [
        { email: { equals: normalizeEmail(email) } },
        { createdAt: { greater_than: new Date(now - PER_EMAIL_WINDOW_MS).toISOString() } },
      ],
    },
    overrideAccess: true,
  });
  if (byEmail.totalDocs >= PER_EMAIL_LIMIT) return true;

  const byIp = await payload.count({
    collection: "otp-codes",
    where: {
      and: [
        { requestIp: { equals: ip } },
        { createdAt: { greater_than: new Date(now - PER_IP_WINDOW_MS).toISOString() } },
      ],
    },
    overrideAccess: true,
  });
  return byIp.totalDocs >= PER_IP_LIMIT;
}

/**
 * Создаёт учётную запись по живому приглашению и помечает его принятым.
 * Используется и ссылкой из письма, и входом по коду.
 */
export async function acceptPendingInvitation(
  emailInput: string,
): Promise<string | number | null> {
  const email = normalizeEmail(emailInput);
  const payload = await payloadClient();

  const invites = await payload.find({
    collection: "invitations",
    where: {
      and: [
        { email: { equals: email } },
        { acceptedAt: { exists: false } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  });

  const invite = invites.docs[0];
  if (!invite) return null;

  const user = await payload.create({
    collection: "users",
    data: {
      email,
      // Локальная стратегия Payload требует пароль. Вход по нему не предусмотрен,
      // поэтому ставим случайный, которого не знает никто.
      password: crypto.randomBytes(32).toString("base64url"),
      role: "interpreter",
      invitedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  });

  await payload.update({
    collection: "invitations",
    id: invite.id,
    data: { acceptedAt: new Date().toISOString(), acceptedBy: user.id },
    overrideAccess: true,
  });

  return user.id;
}

export type RequestResult = { ok: true } | { ok: false; error: string };

export async function requestCode(emailInput: string, ip: string): Promise<RequestResult> {
  return atLeast(
    MIN_RESPONSE_MS,
    (async (): Promise<RequestResult> => {
      const email = normalizeEmail(emailInput);
      if (!email.includes("@")) return { ok: false, error: "Введите адрес почты." };

      if (await overRateLimit(email, ip)) return { ok: false, error: TOO_MANY };

      const payload = await payloadClient();
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const allowed = await mayReceiveCode(email);

      // Запись создаётся всегда: она же служит счётчиком частоты для неизвестных
      // адресов, а по содержимому базы отличить приглашённого нельзя — хранится хеш.
      await payload.create({
        collection: "otp-codes",
        data: {
          email,
          codeHash: hashCode(email, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
          attempts: 0,
          requestIp: ip,
          delivered: allowed,
        },
        overrideAccess: true,
      });

      if (allowed) await sendEmail({ to: email, ...codeEmail(code) });

      // Одинаковый ответ в обоих случаях (A4).
      return { ok: true };
    })(),
  );
}

export type VerifyResult =
  | { ok: true; userId: string | number }
  | { ok: false; error: string };

export async function verifyCode(emailInput: string, code: string): Promise<VerifyResult> {
  return atLeast(
    MIN_RESPONSE_MS,
    (async (): Promise<VerifyResult> => {
      const email = normalizeEmail(emailInput);
      const payload = await payloadClient();

      const found = await payload.find({
        collection: "otp-codes",
        where: {
          and: [
            { email: { equals: email } },
            { consumedAt: { exists: false } },
            { expiresAt: { greater_than: new Date().toISOString() } },
          ],
        },
        sort: "-createdAt",
        limit: 1,
        overrideAccess: true,
      });

      const record = found.docs[0];
      if (!record) return { ok: false, error: BAD_CODE };

      if ((record.attempts ?? 0) >= MAX_ATTEMPTS) {
        // A2: код аннулируется, а не остаётся доступным для дальнейшего перебора.
        await payload.update({
          collection: "otp-codes",
          id: record.id,
          data: { consumedAt: new Date().toISOString() },
          overrideAccess: true,
        });
        return { ok: false, error: TOO_MANY };
      }

      const matches = crypto.timingSafeEqual(
        Buffer.from(record.codeHash, "hex"),
        Buffer.from(hashCode(email, code.trim()), "hex"),
      );

      if (!matches) {
        await payload.update({
          collection: "otp-codes",
          id: record.id,
          data: { attempts: (record.attempts ?? 0) + 1 },
          overrideAccess: true,
        });
        return { ok: false, error: BAD_CODE };
      }

      await payload.update({
        collection: "otp-codes",
        id: record.id,
        data: { consumedAt: new Date().toISOString() },
        overrideAccess: true,
      });

      // Код верен только у того, кому письмо реально ушло; для неприглашённых
      // адресов записи создавались, но письма не было — войти по ним нельзя.
      if (!record.delivered) return { ok: false, error: BAD_CODE };

      const users = await payload.find({
        collection: "users",
        where: { email: { equals: email } },
        limit: 1,
        overrideAccess: true,
      });

      if (users.docs[0]) return { ok: true, userId: users.docs[0].id };

      // Учётной записи ещё нет, но письмо ушло — значит было живое приглашение.
      // Код служит вторым способом его принять: ссылку легко потерять в почте.
      const accepted = await acceptPendingInvitation(email);
      return accepted
        ? { ok: true, userId: accepted }
        : { ok: false, error: BAD_CODE };
    })(),
  );
}
