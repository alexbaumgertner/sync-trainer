/**
 * Запасной вход, когда почта не работает:
 *
 *   npm run session -- alex@example.com
 *
 * Печатает значение сессионной куки. Вставить её в браузере для домена
 * приложения — и вы внутри, без письма и без пароля.
 *
 * Почему это не дыра. Паролей в системе нет, и обычный вход — код на почту.
 * Если почта откажет, без запасного пути не войдёт никто, включая владельца.
 * Этот путь требует доступа к базе и к AUTH_SECRET, то есть к серверу. Тот,
 * у кого он есть, и так может всё; сеть здесь ни при чём — маршрута нет,
 * только терминал.
 *
 * Пользователя не создаёт: адрес должен уже существовать. Завести первого —
 * `npm run admin`.
 */
import { getPayload } from "payload";
import config from "../src/payload.config.js";
import { issueToken, SESSION_COOKIE } from "../src/lib/session.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Укажите адрес: npm run session -- alex@example.com");
  process.exit(1);
}

if (!process.env.AUTH_SECRET?.trim()) {
  console.error("Нужен AUTH_SECRET — им подписывается кука.");
  process.exit(1);
}

const payload = await getPayload({ config });

const found = await payload.find({
  collection: "users",
  where: { email: { equals: email } },
  limit: 1,
  overrideAccess: true,
});

const user = found.docs[0];
if (!user) {
  console.error(`Пользователя ${email} нет. Завести: npm run admin -- ${email}`);
  process.exit(1);
}

const { token, maxAge } = issueToken(user.id);

console.log(`\nПользователь: ${user.email} (${user.role})`);
console.log(`Действует: ${Math.round(maxAge / 86400)} дней\n`);
console.log(`Кука ${SESSION_COOKIE}:\n`);
console.log(token);
console.log(
  "\nВ браузере: консоль на домене приложения →\n" +
    `  document.cookie = "${SESSION_COOKIE}=<значение>; path=/"\n` +
    "Либо во вкладке Application → Cookies.\n",
);
process.exit(0);
