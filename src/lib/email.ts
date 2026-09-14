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

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
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
  });

  if (error) throw new Error(`Resend отказал: ${error.message}`);
}

export function codeEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} — код для входа`,
    text: [
      `Код для входа: ${code}`,
      "",
      "Он действует 10 минут и срабатывает один раз.",
      "Если вы не запрашивали вход, просто удалите это письмо.",
    ].join("\n"),
  };
}

export function inviteEmail(link: string, note?: string): { subject: string; text: string } {
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
  };
}
