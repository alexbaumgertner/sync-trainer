// Без пометки server-only: модуль зовут маршрут и тесты.
import type { Payload } from "payload";
import { appBaseUrl } from "./invite-token";
import { sendEmail, emailConfigured } from "./email";

/**
 * Напоминание о разборе через день после события (E5).
 *
 * Разбор делают по горячим следам или не делают вовсе: через неделю никто
 * уже не вспомнит, на какой панели сбился темп. Отсюда и день — не час
 * (событие могло идти до вечера) и не неделя.
 */

/** Раньше этого не напоминаем: событие могло идти весь день. */
const AFTER_HOURS = 24;

/**
 * Позже этого — молчим.
 *
 * Без верхней границы первый же запуск разослал бы письма по всем старым
 * проектам разом: напоминание о конференции полугодовой давности выглядит
 * как сломавшаяся рассылка, а не как забота.
 */
const BEFORE_DAYS = 14;

/** Больше этого за один проход не шлём: суточная пачка, а не веерная рассылка. */
const MAX_PER_RUN = 50;

export interface ReminderReport {
  considered: number;
  sent: { projectId: number; email: string }[];
  skipped: { projectId: number; why: string }[];
}

export function reminderEmail(args: {
  title: string;
  eventName: string | null;
  url: string;
}): { subject: string; text: string } {
  const what = args.eventName?.trim() || args.title;
  return {
    subject: `Разбор: ${what}`,
    text: [
      `Событие «${what}» прошло. Пока помните — запишите разбор:`,
      "",
      args.url,
      "",
      "Что было труднее всего, чем событие разошлось с ожиданием, каких терминов",
      "не хватило. Это не отчёт: из этих ответов вырастет подготовка к следующему",
      "событию — недостающие термины попадут в глоссарий, а трудности в генерацию.",
      "",
      "Напоминаем один раз.",
    ].join("\n"),
  };
}

export async function sendDebriefReminders(
  payload: Payload,
  now: Date = new Date(),
): Promise<ReminderReport> {
  const report: ReminderReport = { considered: 0, sent: [], skipped: [] };

  const until = new Date(now.getTime() - AFTER_HOURS * 3600e3);
  const from = new Date(now.getTime() - BEFORE_DAYS * 24 * 3600e3);

  const candidates = await payload.find({
    collection: "projects",
    where: {
      and: [
        { eventStartsOn: { less_than: until.toISOString() } },
        { eventStartsOn: { greater_than: from.toISOString() } },
        { debriefRemindedAt: { exists: false } },
      ],
    },
    sort: "eventStartsOn",
    limit: MAX_PER_RUN,
    depth: 1,
    overrideAccess: true,
  });

  report.considered = candidates.docs.length;

  for (const project of candidates.docs) {
    // Разбор уже написан — напоминать не о чем. Проверяем отдельным запросом,
    // а не по статусу проекта: статус можно поменять руками, разбор нельзя.
    const debriefs = await payload.count({
      collection: "debriefs",
      where: { project: { equals: project.id } },
      overrideAccess: true,
    });
    if (debriefs.totalDocs > 0) {
      // Отметку всё равно ставим: иначе проект будет перебираться каждый день.
      await mark(payload, project.id, now);
      report.skipped.push({ projectId: project.id, why: "разбор уже есть" });
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
        ...reminderEmail({
          title: project.title,
          eventName: project.eventName ?? null,
          url: `${appBaseUrl()}/projects/${project.id}/debrief`,
        }),
      });
      // Отметку ставим только после удачной отправки: иначе отказ почты
      // означал бы, что напоминание потеряно навсегда.
      await mark(payload, project.id, now);
      report.sent.push({ projectId: project.id, email });
    } catch (error) {
      console.error("[reminder] письмо не ушло", project.id, error);
      report.skipped.push({ projectId: project.id, why: "письмо не ушло" });
    }
  }

  return report;
}

const mark = (payload: Payload, id: number, now: Date) =>
  payload.update({
    collection: "projects",
    id,
    data: { debriefRemindedAt: now.toISOString() },
    overrideAccess: true,
  });

export const remindersConfigured = emailConfigured;
