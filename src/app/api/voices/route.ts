import { NextResponse } from "next/server";
import { getClient, explainError, hasCredentials, NO_CREDENTIALS } from "@/lib/google-tts";
import { FALLBACK_VOICES, makeVoiceOption, type VoiceOption } from "@/lib/voices";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get("lang") ?? "en";

  if (!hasCredentials()) {
    return NextResponse.json({ voices: FALLBACK_VOICES, source: "fallback", warning: NO_CREDENTIALS });
  }

  try {
    const [response] = await getClient().listVoices({});
    const voices: VoiceOption[] = (response.voices ?? [])
      .flatMap((v) => {
        const name = v.name ?? "";
        const languageCode = v.languageCodes?.[0] ?? "";
        if (!name || !languageCode.startsWith(prefix)) return [];
        return [makeVoiceOption(name, languageCode, String(v.ssmlGender ?? "NEUTRAL"))];
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ voices: voices.length ? voices : FALLBACK_VOICES, source: "google" });
  } catch (error) {
    // Без кредов UI всё равно должен открываться и показывать список.
    return NextResponse.json({
      voices: FALLBACK_VOICES,
      source: "fallback",
      warning: explainError(error),
    });
  }
}
