// Без пометки server-only намеренно: модуль используют и маршруты Next,
// и скрипты обслуживания, которые исполняются вне Next. В клиентский код он
// не попадёт — тянет за собой Payload и доступ к базе.
import { payloadClient } from "./payload";
import { acceptPendingInvitation } from "./otp";
import { generateInviteToken, hashInviteToken, inviteLink } from "./invite-token";

export { inviteLink };

/**
 * Персональные приглашения (A5).
 *
 * В базе лежит только хеш токена: по содержимому базы ссылку не восстановить.
 * Сам токен существует единственный раз — в письме.
 */

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export async function createInvitation(args: {
  email: string;
  invitedBy?: number;
  note?: string;
}): Promise<{ link: string }> {
  const email = normalizeEmail(args.email);
  const payload = await payloadClient();
  const token = generateInviteToken();

  await payload.create({
    collection: "invitations",
    data: { email, invitedBy: args.invitedBy, note: args.note },
    // Хеш, срок и письмо — забота хука коллекции. Свой токен передаём сюда,
    // чтобы вернуть готовую ссылку вызывающему.
    context: { inviteToken: token },
    overrideAccess: true,
  });

  // Письмо отправляет хук коллекции: так приглашение работает и из админки,
  // и из кода — одним путём, а не двумя.
  return { link: inviteLink(token) };
}

export type RedeemResult =
  | { ok: true; userId: string | number }
  | { ok: false; error: string };

export const INVALID_INVITE =
  "Ссылка недействительна. Возможно, ей уже воспользовались или истёк срок.";

/** Ссылка одноразовая: повторный переход по ней ничего не даёт. */
export async function redeemInvitation(token: string): Promise<RedeemResult> {
  const payload = await payloadClient();

  const found = await payload.find({
    collection: "invitations",
    where: { tokenHash: { equals: hashInviteToken(token) } },
    limit: 1,
    overrideAccess: true,
  });

  const invite = found.docs[0];
  if (!invite) return { ok: false, error: INVALID_INVITE };
  if (invite.acceptedAt) return { ok: false, error: INVALID_INVITE };
  // Срок проставляет хук; пустое поле означает битую запись, а не вечную ссылку.
  if (!invite.expiresAt || new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: INVALID_INVITE };
  }

  // Учётная запись уже могла появиться — например, приглашение приняли кодом.
  const users = await payload.find({
    collection: "users",
    where: { email: { equals: invite.email } },
    limit: 1,
    overrideAccess: true,
  });

  if (users.docs[0]) {
    await payload.update({
      collection: "invitations",
      id: invite.id,
      data: { acceptedAt: new Date().toISOString(), acceptedBy: users.docs[0].id },
      overrideAccess: true,
    });
    return { ok: true, userId: users.docs[0].id };
  }

  const userId = await acceptPendingInvitation(invite.email);
  return userId ? { ok: true, userId } : { ok: false, error: INVALID_INVITE };
}
