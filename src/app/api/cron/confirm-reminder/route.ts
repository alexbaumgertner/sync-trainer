import { NextResponse } from "next/server";
import { payloadClient } from "@/lib/payload";
import { sendConfirmReminders } from "@/lib/confirm-reminder";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Суточное напоминание о неподтверждённом участии (C6).
 *
 * Отдельным маршрутом от копии базы и от напоминания о разборе: у трёх
 * рассылок разная цена отказа, и складывать их в один обработчик значит
 * однажды потерять важное из-за сломавшегося неважного.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authorized =
    !secret || request.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) {
    return NextResponse.json({ error: "Нужен CRON_SECRET." }, { status: 401 });
  }

  try {
    const payload = await payloadClient();
    const report = await sendConfirmReminders(payload);

    return NextResponse.json({
      ok: true,
      considered: report.considered,
      sent: report.sent.length,
      skipped: report.skipped.length,
    });
  } catch (error) {
    console.error("[confirm] проход не удался", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
