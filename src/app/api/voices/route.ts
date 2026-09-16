import { NextResponse } from "next/server";
import { getClient, explainError, hasCredentials, NO_CREDENTIALS } from "@/lib/google-tts";
import { guard } from "@/lib/auth";
import { FALLBACK_VOICES } from "@/lib/voices";
import { forLanguage, listVoicesCached } from "@/lib/voice-catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const prefix = new URL(request.url).searchParams.get("lang") ?? "en";

  if (!hasCredentials()) {
    return NextResponse.json({ voices: FALLBACK_VOICES, source: "fallback", warning: NO_CREDENTIALS });
  }

  try {
    // Каталог кэшируется на сутки: он меняется хорошо если раз в месяц,
    // а ходил в Google на каждый запрос — круговой путь на критическом пути.
    const { voices, source } = await listVoicesCached(async () => {
      const [response] = await getClient().listVoices({});
      return response.voices ?? [];
    });

    const forThisLanguage = forLanguage(voices, prefix);
    return NextResponse.json({
      voices: forThisLanguage.length ? forThisLanguage : FALLBACK_VOICES,
      source,
    });
  } catch (error) {
    // Без кредов и при отказе Google интерфейс всё равно должен открываться.
    return NextResponse.json({
      voices: FALLBACK_VOICES,
      source: "fallback",
      warning: explainError(error),
    });
  }
}
