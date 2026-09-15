/**
 * Первый администратор — без пароля:
 *
 *   npm run admin -- alex@example.com
 *
 * Раньше эту роль играл `/payload-api/users/first-register`, но он часть
 * парольного входа, которого больше нет. Заводить первого пользователя через
 * сеть и так было сомнительно: эндпоинт открыт, пока в базе пусто.
 *
 * Существующему адресу поднимает роль до администратора — так лечится
 * «сам себя разжаловал».
 */
import { getPayload } from "payload";
import config from "../src/payload.config.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Укажите адрес: npm run admin -- alex@example.com");
  process.exit(1);
}

const payload = await getPayload({ config });

const found = await payload.find({
  collection: "users",
  where: { email: { equals: email } },
  limit: 1,
  overrideAccess: true,
});

if (found.docs[0]) {
  const user = found.docs[0];
  if (user.role === "admin") {
    console.log(`${email} уже администратор.`);
  } else {
    await payload.update({
      collection: "users",
      id: user.id,
      data: { role: "admin" },
      overrideAccess: true,
    });
    console.log(`${email}: роль поднята до администратора.`);
  }
} else {
  const user = await payload.create({
    collection: "users",
    data: { email, role: "admin", invitedAt: new Date().toISOString() },
    overrideAccess: true,
  });
  console.log(`Создан администратор ${user.email} (id ${user.id}).`);
}

console.log("Входить — по коду на почту. Если почта молчит: npm run session -- " + email);
process.exit(0);
