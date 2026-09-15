// Без пометки server-only: модуль зовут маршрут и тесты.
import type { Payload } from "payload";
import { appBaseUrl } from "./invite-token";
import { sendEmail, emailConfigured } from "./email";
import type { Engagement } from "@/payload-types";

type Member = NonNullable<Engagement["team"]>[number];

/**
 * Напоминание о неподтверждённом участии (C6).
 *
 * Правила взяты у напоминания о разборе (E5) намеренно: они там не случайны,
 * а выведены из того, что превращает напоминание в преследование. Повторять
 * рассуждение заново значило бы однажды разойтись в мелочи и получить две
 * рассылки с разным характером.
 *
 * Отличие одно: пишем не владельцу записи, а названному в ней коллеге —
 * решение за ним, и торопить его можно ровно один раз.
 */

/** Раньше — суета: человек мог просто не дойти до почты. */
const AFTER_DAYS = 3;

/** Позже — бессмысленно: событие забылось, подтверждать нечего. */
const BEFORE_DAYS = 60;

const MAX_PER_RUN = 50;

export interface ConfirmReminderReport {
  considered: number;
  sent: { engagementId: number; email: string }[];
  skipped: { engagementId: number; why: string }[];
}

export function confirmReminderEmail(args: {
  who: string;
  event: string;
  url: string;
}): { subject: string; text: string } {
  return {
    subject: `Напоминание: подтвердите участие в «${args.event}»`,
    text: [
      `${args.who} указал вас в команде события «${args.event}», но ответа пока нет.`,
      "",
      args.url,
      "",
      "Пока вы не ответили, участие показывается как неподтверждённое —",
      "то есть как заявление, а не как факт. Если вас там не было, так и скажите:",
      "кнопка «Меня там не было» на той же странице.",
      "",
      "Напоминаем один раз.",
    ].join("\n"),
  };
}

export async function sendConfirmReminders(
  payload: Payload,
  now: Date = new Date(),
): Promise<ConfirmReminderReport> {
  const report: ConfirmReminderReport = { considered: 0, sent: [], skipped: [] };
  if (!emailConfigured()) return report;

  const until = new Date(now.getTime() - AFTER_DAYS * 24 * 3600e3);
  const from = new Date(now.getTime() - BEFORE_DAYS * 24 * 3600e3);

  const candidates = await payload.find({
    collection: "engagements",
    where: {
      and: [
        { heldOn: { less_than: until.toISOString() } },
        { heldOn: { greater_than: from.toISOString() } },
        { "team.status": { equals: "invited" } },
      ],
    },
    sort: "heldOn",
    limit: MAX_PER_RUN,
    depth: 0,
    overrideAccess: true,
  });

  report.considered = candidates.docs.length;

  for (const doc of candidates.docs) {
    const ownerId = typeof doc.owner === "object" ? doc.owner?.id : doc.owner;
    const author =
      typeof ownerId === "number"
        ? await payload
            .findByID({ collection: "users", id: ownerId, depth: 0, overrideAccess: true })
            .catch(() => null)
        : null;
    const who = author?.displayName?.trim() || "Коллега";

    const team = (doc.team ?? []) as Member[];
    const next = [...team];
    let changed = false;

    for (let i = 0; i < next.length; i++) {
      const member = next[i];
      // Только приглашённые и не ответившие. Подтвердившего и оспорившего
      // тревожить незачем, а «названный» ещё не получал и первого письма.
      //
      // Эта проверка НЕ дублирует отбор в запросе, хотя по отдельности каждая
      // из них покрывает тесты. Запрос отбирает записи, а в одной записи
      // бывает несколько участников с разными статусами: он вытащит её
      // целиком, и без проверки здесь письмо ушло бы и подтвердившему.
      if (member.status !== "invited") continue;

      const userId = typeof member.user === "object" ? member.user?.id : member.user;
      if (typeof userId !== "number") continue;

      const person = await payload
        .findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true })
        .catch(() => null);
      if (!person?.email) {
        report.skipped.push({ engagementId: doc.id, why: "у участника нет почты" });
        continue;
      }

      try {
        await sendEmail({
          to: person.email,
          ...confirmReminderEmail({
            who,
            event: doc.title,
            url: `${appBaseUrl()}/experience/${doc.id}`,
          }),
        });
        // «Напомнили» — отдельный статус, иначе напоминание пошло бы каждые
        // сутки и стало преследованием. Ставим только после удачной отправки.
        next[i] = { ...member, status: "reminded" as Member["status"] };
        changed = true;
        report.sent.push({ engagementId: doc.id, email: person.email });
      } catch (error) {
        console.error("[confirm] напоминание не ушло", doc.id, error);
        report.skipped.push({ engagementId: doc.id, why: "письмо не ушло" });
      }
    }

    if (changed) {
      await payload.update({
        collection: "engagements",
        id: doc.id,
        data: { team: next },
        overrideAccess: true,
      });
    }
  }

  return report;
}
