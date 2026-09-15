import { NextResponse } from "next/server";
import { payloadClient } from "@/lib/payload";
import { sendDebriefReminders, remindersConfigured } from "@/lib/debrief-reminder";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Суточная рассылка напоминаний о разборе (E5).
 *
 * Отдельным маршрутом от копии базы: у них разная цена отказа. Не ушедшее
 * напоминание — досада, не сделанная копия — беда, и валить их в один
 * обработчик значит однажды потерять копию из-за сломавшегося письма.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authorized =
    !secret || request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) {
    return NextResponse.json({ error: "Нужен CRON_SECRET." }, { status: 401 });
  }

  if (!remindersConfigured()) {
    // Не отказ: без почтового ключа слать просто нечем, и это нормальное
    // состояние локальной разработки.
    return NextResponse.json({ ok: true, skipped: "почта не настроена" });
  }

  try {
    const payload = await payloadClient();
    const report = await sendDebriefReminders(payload);

    return NextResponse.json({
      ok: true,
      considered: report.considered,
      sent: report.sent.length,
      skipped: report.skipped.length,
    });
  } catch (error) {
    console.error("[reminder] проход не удался", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
