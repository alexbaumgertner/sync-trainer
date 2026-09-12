import { NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { readUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  try {
    return NextResponse.json(await readUsage());
  } catch (error) {
    console.error("[usage] read failed", error);
    return NextResponse.json(
      { error: "Не удалось прочитать статистику расходов", detail: (error as Error).message },
      { status: 502 },
    );
  }
}
