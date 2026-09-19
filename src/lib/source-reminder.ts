// Без пометки server-only: модуль зовут маршрут и тесты.
import type { Payload } from "payload";
import { appBaseUrl } from "./invite-token";
import { sendEmail, emailConfigured } from "./email";

/**
 * Предложение удалить оригиналы через неделю после события (S4).
 *
 * С R3 оригиналы не удаляются сами: переводчики их не удаляют, а для многих
 * организаций материалы публичны. Цену этого решения назвали вслух —
 * документы заказчиков лежат в хранилище неопределённо долго, — и это
 * письмо и есть то, чем цена удерживается: не автоматика, а напоминание.
 *
 * Оно ПРЕДЛАГАЕТ. Ничего не удаляет и ничего не просит подтвердить: человек
 * решает сам, и молчание — тоже решение.
 */

/**
 * Неделя, а не сутки.
 *
 * Сутками отмеряется разбор — его пишут по горячим следам. К материалам же
 * возвращаются и после события: сверить, дописать в глоссарий то, что
 * прозвучало. Предложить убрать их назавтра значит помешать работе.
 */
const AFTER_DAYS = 7;

/**
 * Позже этого молчим.
 *
 * Без верхней границы первый запуск разослал бы письма по всем старым
 * проектам разом. Та же причина, что у напоминания о разборе, и то же
 * следствие: выглядело бы сломавшейся рассылкой.
 */
const BEFORE_DAYS = 60;

/** Больше этого за проход не шлём: суточная пачка, а не веер. */
const MAX_PER_RUN = 50;

export interface SourceReminderReport {
  considered: number;
  sent: { projectId: number; email: string; documents: number }[];
  skipped: { projectId: number; why: string }[];
}

export function sourceReminderEmail(args: {
  title: string;
  eventName: string | null;
  documents: number;
  url: string;
}): { subject: string; text: string } {
  const what = args.eventName?.trim() || args.title;
  const count =
    args.documents === 1 ? "один исходный документ" : `исходных документов: ${args.documents}`;
  return {
    subject: `Материалы после события: ${what}`,
    text: [
      `Событие «${what}» прошло неделю назад. В проекте хранится ${count}.`,
      "",
      args.url,
      "",
      "Если материалы были под NDA — их, возможно, пора убрать. Если они",
      "открытые, ничего делать не нужно: мы ничего не удаляем сами, это",
      "только напоминание.",
      "",
      "Удаление оригинала не трогает ни скрипт, ни звук, ни глоссарий — они",
      "остаются. Пропадёт лишь возможность собрать по этому файлу заново.",
      "",
      "Предлагаем один раз.",
    ].join("\n"),
  };
}

export async function sendSourceReminders(
  payload: Payload,
  now: Date = new Date(),
): Promise<SourceReminderReport> {
  const report: SourceReminderReport = { considered: 0, sent: [], skipped: [] };

  const until = new Date(now.getTime() - AFTER_DAYS * 24 * 3600e3);
  const from = new Date(now.getTime() - BEFORE_DAYS * 24 * 3600e3);

  const candidates = await payload.find({
    collection: "projects",
    where: {
      and: [
        { eventStartsOn: { less_than: until.toISOString() } },
        { eventStartsOn: { greater_than: from.toISOString() } },
        { sourcesRemindedAt: { exists: false } },
      ],
    },
    sort: "eventStartsOn",
    limit: MAX_PER_RUN,
    depth: 1,
    overrideAccess: true,
  });

  report.considered = candidates.docs.length;

  for (const project of candidates.docs) {
    // Считаем документы, у которых оригинал ещё лежит. Пустой путь означает
    // «оригинала нет» — либо человек уже удалил, либо файл не сохранился.
    const stored = await payload.count({
      collection: "documents",
      where: {
        and: [{ project: { equals: project.id } }, { blobPath: { exists: true } }],
      },
      overrideAccess: true,
    });

    if (stored.totalDocs === 0) {
      // Удалять нечего — но отметку ставим, иначе проект будет перебираться
      // каждые сутки до самой верхней границы.
      await mark(payload, project.id, now);
      report.skipped.push({ projectId: project.id, why: "оригиналов нет" });
      continue;
    }

    const owner = project.owner;
    const email = typeof owner === "object" ? owner?.email : null;
    if (!email) {
      report.skipped.push({ projectId: project.id, why: "у проекта нет владельца с почтой" });
      continue;
    }

    try {
      await sendEmail({
        to: email,
        ...sourceReminderEmail({
          title: project.title,
          eventName: project.eventName ?? null,
          documents: stored.totalDocs,
          url: `${appBaseUrl()}/projects/${project.id}`,
        }),
      });
      // Отметка только после удачной отправки: иначе отказ почты означал бы,
      // что предложение потеряно навсегда.
      await mark(payload, project.id, now);
      report.sent.push({ projectId: project.id, email, documents: stored.totalDocs });
    } catch (error) {
      console.error("[sources] письмо не ушло", project.id, error);
      report.skipped.push({ projectId: project.id, why: "письмо не ушло" });
    }
  }

  return report;
}

const mark = (payload: Payload, id: number, now: Date) =>
  payload.update({
    collection: "projects",
    id,
    data: { sourcesRemindedAt: now.toISOString() },
    overrideAccess: true,
  });

export const sourceRemindersConfigured = emailConfigured;
