import { NextResponse } from "next/server";
import { CRON_FORBIDDEN, cronAuthorized } from "@/lib/cron-auth";
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
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: CRON_FORBIDDEN }, { status: 401 });
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
