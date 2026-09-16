import "server-only";
import { makeVoiceOption, type VoiceOption } from "./voices";

/**
 * Каталог голосов Google с суточным кэшем (П2 аудита).
 *
 * Маршрут `/api/voices` ходил в Google на КАЖДЫЙ запрос, а каталог меняется
 * хорошо если раз в месяц. Это круговой путь до Google на критическом пути
 * страницы проекта — и, что хуже, внешняя зависимость там, где её быть
 * не должно: пока Google думает, страница ждёт.
 *
 * Кэш в памяти процесса, а не в базе, и это осознанно. На Fluid Compute
 * экземпляры переиспользуются, так что попаданий будет много; а даже при
 * промахе мы теряем ровно то, что теряли раньше всегда. Заводить ради
 * справочника таблицу — плата больше пользы.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  at: number;
  voices: VoiceOption[];
}

let cache: Entry | null = null;

/** Для тестов: кэш живёт в модуле, и между проверками его надо сбрасывать. */
export function resetVoiceCache(): void {
  cache = null;
}

export type CatalogueSource = "google" | "cache" | "stale";

/**
 * Весь каталог, без отбора по языку.
 *
 * Отбор идёт после кэша намеренно: Google отдаёт список целиком, и кэшировать
 * его по языкам значило бы держать восемь почти одинаковых копий и ходить
 * в Google заново на каждый новый язык.
 */
export async function listVoicesCached(
  fetchVoices: () => Promise<{ name?: string | null; languageCodes?: (string | null)[] | null; ssmlGender?: unknown }[]>,
  now = Date.now(),
): Promise<{ voices: VoiceOption[]; source: CatalogueSource }> {
  if (cache && now - cache.at < TTL_MS) return { voices: cache.voices, source: "cache" };

  try {
    const raw = await fetchVoices();
    const voices = raw.flatMap((v) => {
      const name = v.name ?? "";
      const languageCode = v.languageCodes?.[0] ?? "";
      if (!name || !languageCode) return [];
      return [makeVoiceOption(name, languageCode, String(v.ssmlGender ?? "NEUTRAL"))];
    });

    cache = { at: now, voices };
    return { voices, source: "google" };
  } catch (error) {
    // Протухший список лучше запасного: в нём настоящие голоса, которые
    // у проекта уже могут быть выбраны. Отдаём его и не трогаем отметку
    // времени, чтобы следующий запрос попробовал Google снова.
    if (cache) return { voices: cache.voices, source: "stale" };
    throw error;
  }
}

/** Отбор по языку — после кэша, а не до него. */
export const forLanguage = (voices: VoiceOption[], prefix: string): VoiceOption[] =>
  voices
    .filter((voice) => voice.languageCode.startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name));
