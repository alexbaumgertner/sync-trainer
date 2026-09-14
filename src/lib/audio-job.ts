// Без пометки server-only: модуль зовут и маршрут, и тесты напрямую.
import type { Payload } from "payload";
import type { PlanItem } from "@/lib/ssml";
import { synthesizePlan, explainError } from "@/lib/google-tts";
import { artifactPath, putArtifact } from "@/lib/artifacts";
import { withId3, SYNTHETIC_NOTICE } from "@/lib/id3";
import { recordUsage } from "@/lib/usage";
import { tierOf, TIER_LABEL } from "@/lib/voices";

/**
 * Синтез аудио как фоновая работа (U3).
 *
 * Раньше это тело жило внутри обработчика запроса, и человек был обязан
 * держать вкладку открытой все сорок секунд — закрыл, и деньги списаны,
 * а файла нет. Теперь обработчик заводит запись о генерации и отдаёт ответ,
 * а работа продолжается здесь, после ответа.
 *
 * Отсюда правило: **функция не выбрасывает наружу**. Бросать некому — ответ
 * уже ушёл, и единственное место, где человек увидит отказ, это запись
 * в базе. Поэтому любая ошибка заканчивается статусом `failed` с причиной.
 */

export interface AudioJob {
  payload: Payload;
  generationId: number;
  projectId: number;
  projectTitle: string;
  userId: number;
  plan: PlanItem[];
  defaultVoice: string;
  speakerVoices: Record<string, string>;
  speakingRate: number | undefined;
  usedVoices: string[];
  billableChars: number;
  costUsd: number;
}

export async function runAudioJob(job: AudioJob): Promise<void> {
  const { payload, generationId, projectId } = job;

  try {
    const audio = await synthesizePlan(job.plan, {
      defaultVoice: job.defaultVoice,
      speakerVoices: job.speakerVoices,
      speakingRate: job.speakingRate,
    });

    // G5: пометка о синтетичности живёт и в самом файле, а не только на экране.
    const tagged = withId3(audio, { title: job.projectTitle, comment: SYNTHETIC_NOTICE });

    const blobPath = artifactPath(projectId, "audio.mp3");
    const { bytes } = await putArtifact(blobPath, tagged, "audio/mpeg");

    // Предыдущая озвучка проекта заменяется: файл в хранилище один и тот же,
    // и две строки на него означали бы битую ссылку у одной из них.
    const existing = await payload.find({
      collection: "artifacts",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: "audio" } }] },
      limit: 10,
      overrideAccess: true,
    });
    for (const old of existing.docs) {
      await payload.delete({ collection: "artifacts", id: old.id, overrideAccess: true });
    }

    await payload.create({
      collection: "artifacts",
      data: { project: projectId, generation: generationId, kind: "audio", blobPath, bytes },
      overrideAccess: true,
    });

    await payload.update({
      collection: "generations",
      id: generationId,
      data: {
        status: "done",
        model: job.defaultVoice,
        chars: job.billableChars,
        costUsd: job.costUsd,
      },
      overrideAccess: true,
    });

    await payload.update({
      collection: "projects",
      id: projectId,
      data: { status: "ready" },
      overrideAccess: true,
    });

    // Расход записывается последним: до этой строки за работу ещё не платили
    // в учёте, и оборванная на середине задача не оставит счёт без файла.
    await recordUsage({
      userId: job.userId,
      projectId,
      kind: "audio",
      chars: job.billableChars,
      costUsd: job.costUsd,
      tier: TIER_LABEL[tierOf(job.defaultVoice)],
      voices: job.usedVoices,
    });
  } catch (error) {
    console.error("[audio] синтез не удался", error);
    await payload
      .update({
        collection: "generations",
        id: generationId,
        data: { status: "failed", error: explainError(error) },
        overrideAccess: true,
      })
      .catch((nested: unknown) => {
        // Если и запись об отказе не прошла, генерация останется «выполняется»
        // и будет опознана как оборванная по времени — см. lib/generations.ts.
        console.error("[audio] не удалось записать отказ", nested);
      });
  }
}
