import { NextResponse } from "next/server";
import { parseScript, planSynthesis, analyzeScript, DEFAULT_CHUNK_BYTES } from "@/lib/ssml";
import { synthesizePlan, explainError, hasCredentials, NO_CREDENTIALS } from "@/lib/google-tts";
import { formatForVoices, estimateCostUsd, tierOf, TIER_LABEL, DEFAULT_VOICE } from "@/lib/voices";
import { guard } from "@/lib/auth";
import { recordUsage } from "@/lib/usage";
import type { TtsRequest } from "@/lib/api-types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Предохранитель от случайной генерации на весь бюджет. */
const MAX_BILLABLE_CHARS = Number(process.env.TTS_MAX_CHARS ?? 120_000);

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: TtsRequest;
  try {
    body = (await request.json()) as TtsRequest;
  } catch {
    return NextResponse.json({ error: "Ожидался JSON в теле запроса" }, { status: 400 });
  }

  if (!hasCredentials()) return NextResponse.json({ error: NO_CREDENTIALS }, { status: 503 });

  const script = body.script?.trim();
  if (!script) return NextResponse.json({ error: "Пустой скрипт" }, { status: 400 });

  const defaultVoice = body.voice || DEFAULT_VOICE;
  const speakerVoices = body.mode === "perSpeaker" ? (body.speakerVoices ?? {}) : {};
  const usedVoices = [defaultVoice, ...Object.values(speakerVoices)];

  // Формат диктуют голоса: Chirp 3 HD / Journey не принимают SSML, поэтому для
  // них разметка снимается автоматически, а <break> становится реальной тишиной.
  const format = formatForVoices(usedVoices);

  const parsed = parseScript(script);
  const rate = body.rate === undefined ? parsed.rate : body.rate;

  let plan;
  try {
    plan = planSynthesis(parsed.blocks, {
      format,
      rate,
      perSpeaker: body.mode === "perSpeaker",
      stripLabels: body.stripLabels ?? body.mode === "perSpeaker",
      maxBytes: body.maxBytes ?? DEFAULT_CHUNK_BYTES,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const speechItems = plan.filter((item) => item.type === "speech");
  if (!speechItems.length) {
    return NextResponse.json({ error: "В скрипте не нашлось текста для озвучки" }, { status: 400 });
  }

  const billableChars = speechItems.reduce((sum, c) => sum + c.billableChars, 0);
  if (billableChars > MAX_BILLABLE_CHARS) {
    return NextResponse.json(
      {
        error: `Скрипт на ${billableChars.toLocaleString("ru-RU")} тарифицируемых символов превышает лимит ${MAX_BILLABLE_CHARS.toLocaleString("ru-RU")}. Поднимите TTS_MAX_CHARS, если это осознанно.`,
      },
      { status: 413 },
    );
  }

  const stats = analyzeScript(parsed.blocks, rate);
  const startedAt = Date.now();

  try {
    // В text-режиме <prosody rate> уже не работает — темп уходит в audioConfig.
    const speakingRate =
      body.speakingRate ?? (format === "text" && rate ? (parseFloat(rate) || 100) / 100 : undefined);

    const audio = await synthesizePlan(plan, {
      defaultVoice,
      speakerVoices,
      speakingRate,
      pitch: body.pitch,
    });

    // Учёт расходов не должен ронять уже оплаченную генерацию, поэтому
    // ошибка записи только логируется — аудио пользователь получает в любом случае.
    const distinctVoices = [...new Set(usedVoices)];
    try {
      await recordUsage({
        at: new Date().toISOString(),
        chars: billableChars,
        costUsd: estimateCostUsd(billableChars, distinctVoices),
        tier: TIER_LABEL[tierOf(defaultVoice)],
        voices: distinctVoices,
        format,
        chunks: speechItems.length,
        seconds: Math.round(stats.estimatedSeconds),
      });
    } catch (error) {
      console.error("[tts] не удалось записать расход", error);
    }

    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Content-Disposition": `attachment; filename="training-${Date.now()}.mp3"`,
        "Cache-Control": "no-store",
        "X-Chunk-Count": String(speechItems.length),
        "X-Format": format,
        "X-Silence-Count": String(plan.length - speechItems.length),
        "X-Billable-Chars": String(billableChars),
        "X-Estimated-Seconds": stats.estimatedSeconds.toFixed(0),
        "X-Elapsed-Ms": String(Date.now() - startedAt),
        "Access-Control-Expose-Headers":
          "X-Chunk-Count, X-Billable-Chars, X-Estimated-Seconds, X-Elapsed-Ms, X-Format, X-Silence-Count",
      },
    });
  } catch (error) {
    console.error("[tts] synthesis failed", error);
    return NextResponse.json(
      { error: explainError(error), detail: (error as Error)?.message },
      { status: 502 },
    );
  }
}
