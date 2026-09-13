/**
 * Приглашение из терминала:
 *   npm run invite -- someone@example.com "необязательная заметка"
 *
 * Хеш, срок и письмо выписывает хук коллекции — тот же, что работает в админке.
 * Скрипт лишь передаёт свой токен через context, чтобы показать готовую ссылку.
 *
 * Без RESEND_API_KEY письмо печатается в вывод сервера, ссылка видна и здесь.
 */
import { getPayload } from "payload";
import config from "../src/payload.config.js";
import { generateInviteToken, inviteLink } from "../src/lib/invite-token.js";

const [email, note] = process.argv.slice(2);

if (!email?.includes("@")) {
  console.error("Укажите адрес: npm run invite -- someone@example.com");
  process.exit(1);
}

const payload = await getPayload({ config });
const token = generateInviteToken();

await payload.create({
  collection: "invitations",
  data: { email: email.trim().toLowerCase(), note },
  context: { inviteToken: token },
  overrideAccess: true,
});

console.log(`\nПриглашение создано для ${email}`);
console.log(`Ссылка: ${inviteLink(token)}`);
console.log("Письмо ушло, если задан RESEND_API_KEY.\n");
process.exit(0);
