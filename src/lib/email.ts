// Без пометки server-only намеренно: этот модуль вызывает хук коллекции,
// а конфигурация Payload исполняется в том числе вне Next — в CLI и скриптах.
// В клиентский код он не попадает: его импортируют только серверные модули.
import { Resend } from "resend";

/**
 * Отправка писем.
 *
 * В разработке без ключа письмо печатается в консоль, а не молча теряется:
 * иначе первый же запуск выглядит как сломанный вход.
 */

const FROM = process.env.EMAIL_FROM ?? "Тренажёр синхрониста <noreply@localhost>";

let client: Resend | null = null;

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

export const emailConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY?.trim());

export interface Attachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
}): Promise<void> {
  const service = resend();

  if (!service) {
    console.info(
      `\n─── письмо не отправлено, нет RESEND_API_KEY ───\nКому: ${args.to}\nТема: ${args.subject}\n\n${args.text}\n───────────────────────────────────────────────\n`,
    );
    return;
  }

  const { error } = await service.emails.send({
    from: FROM,
    to: args.to,
    subject: args.subject,
    text: args.text,
    ...(args.html ? { html: args.html } : {}),
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
  });

  if (error) throw new Error(`Resend отказал: ${error.message}`);
}

/**
 * Письма транспортные, а не рассылка: ни отписки, ни картинок, ни трекинга.
 *
 * HTML-часть здесь не украшение. Голый текст с шестизначным кодом и без единого
 * признака отправителя — это ровно форма фишинга, и первое же письмо с нового
 * домена Gmail отправил в спам. Поэтому в письме видно, кто пишет и почему.
 * Текстовая часть остаётся: по ней читают те, у кого HTML отключён.
 */
const SENDER = "Тренажёр синхрониста";

const shell = (body: string, footer: string): string =>
  [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
    'font-size:15px;line-height:1.55;color:#1a1a1a;max-width:32rem">',
    `<p style="margin:0 0 1.25rem;font-weight:600">${SENDER}</p>`,
    body,
    `<p style="margin:1.75rem 0 0;font-size:13px;color:#6b6b6b">${footer}</p>`,
    "</div>",
  ].join("");

export function codeEmail(code: string): { subject: string; text: string; html: string } {
  return {
    // Код в теме — его видно в уведомлении, не открывая письмо. Но не первым
    // символом: письмо, начинающееся с голого числа, читается как рассылка.
    subject: `Код для входа: ${code}`,
    text: [
      `Код для входа: ${code}`,
      "",
      "Он действует 10 минут и срабатывает один раз.",
      "Если вы не запрашивали вход, просто удалите это письмо.",
      "",
      `Это письмо отправил ${SENDER} — тренажёр для подготовки к синхронному переводу.`,
    ].join("\n"),
    html: shell(
      [
        '<p style="margin:0 0 .75rem">Код для входа:</p>',
        '<p style="margin:0 0 1.25rem;font-size:30px;font-weight:600;',
        'letter-spacing:.18em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">',
        code,
        "</p>",
        '<p style="margin:0">Он действует 10 минут и срабатывает один раз.</p>',
      ].join(""),
      `Если вы не запрашивали вход, просто удалите это письмо. ${SENDER} — тренажёр для подготовки к синхронному переводу.`,
    ),
  };
}

export function inviteEmail(
  link: string,
  note?: string,
): { subject: string; text: string; html: string } {
  return {
    subject: "Приглашение в тренажёр синхрониста",
    text: [
      "Вас пригласили в тренажёр для подготовки к синхронному переводу.",
      note ? `\n${note}\n` : "",
      "Ссылка для входа:",
      link,
      "",
      "Ссылка одноразовая. Пароль придумывать не нужно: вход по коду на почту.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: shell(
      [
        '<p style="margin:0 0 1rem">Вас пригласили в тренажёр для подготовки к синхронному переводу.</p>',
        note ? `<p style="margin:0 0 1rem">${escapeHtml(note)}</p>` : "",
        `<p style="margin:0 0 1.25rem"><a href="${escapeHtml(link)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:.65rem 1.1rem;border-radius:.5rem">Принять приглашение</a></p>`,
        `<p style="margin:0;font-size:13px;color:#6b6b6b;word-break:break-all">${escapeHtml(link)}</p>`,
      ].join(""),
      "Ссылка одноразовая и действует две недели. Пароль придумывать не нужно: вход по коду на почту.",
    ),
  };
}

/**
 * Вас назвали в команде события (C1).
 *
 * Письмо обязано звать к действию, а не просто уведомлять: пока человек
 * не ответил, участие показывается как неподтверждённое, то есть как
 * заявление владельца записи. Ответ превращает его в факт.
 */
export function teamMentionEmail(args: {
  who: string;
  event: string;
  heldOn: string;
  url: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Вас назвали в команде: ${args.event}`,
    text: [
      `${args.who} завёл запись о событии «${args.event}» (${args.heldOn}) и указал вас в команде.`,
      "",
      "Подтвердите участие или скажите, что вас там не было:",
      args.url,
      "",
      "Пока вы не ответили, участие показывается как неподтверждённое.",
      "Подтверждение — заодно согласие на то, чтобы вас упоминали; его можно отозвать.",
    ].join("\n"),
    html: shell(
      [
        `<p style="margin:0 0 1rem">${escapeHtml(args.who)} завёл запись о событии `,
        `<b>${escapeHtml(args.event)}</b> (${escapeHtml(args.heldOn)}) и указал вас в команде.</p>`,
        `<p style="margin:0 0 1.25rem"><a href="${escapeHtml(args.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:.65rem 1.1rem;border-radius:.5rem">Подтвердить или оспорить</a></p>`,
      ].join(""),
      "Пока вы не ответили, участие показывается как неподтверждённое. Подтверждение — заодно согласие на упоминание, и его можно отозвать.",
    ),
  };
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
