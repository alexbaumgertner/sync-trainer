import { NextResponse } from "next/server";
import { authConfigured, currentUser, NOT_CONFIGURED, UNAUTHORIZED } from "@/lib/auth";
import { readUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!authConfigured()) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });

  try {
    return NextResponse.json(await readUsage(user.id, user.isAdmin));
  } catch (error) {
    console.error("[usage] read failed", error);
    return NextResponse.json(
      { error: "Не удалось прочитать статистику расходов", detail: (error as Error).message },
      { status: 502 },
    );
  }
}
