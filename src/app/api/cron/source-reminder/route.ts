import { NextResponse } from "next/server";
import { CRON_FORBIDDEN, cronAuthorized } from "@/lib/cron-auth";
import { payloadClient } from "@/lib/payload";
import { sendSourceReminders, sourceRemindersConfigured } from "@/lib/source-reminder";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Суточное предложение убрать исходные материалы (S4).
 *
 * Своим маршрутом, а не довеском к напоминанию о разборе: у них разные
 * сроки (сутки против недели) и разная цена отказа. Сложить их вместе
 * значит однажды потерять одно из-за другого.
 */
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: CRON_FORBIDDEN }, { status: 401 });
  }

  if (!sourceRemindersConfigured()) {
    // Не отказ: без почтового ключа слать нечем, и это нормальное
    // состояние локальной разработки.
    return NextResponse.json({ ok: true, skipped: "почта не настроена" });
  }

  try {
    const payload = await payloadClient();
    const report = await sendSourceReminders(payload);

    return NextResponse.json({
      ok: true,
      considered: report.considered,
      sent: report.sent.length,
      skipped: report.skipped.length,
    });
  } catch (error) {
    console.error("[sources] проход не удался", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
