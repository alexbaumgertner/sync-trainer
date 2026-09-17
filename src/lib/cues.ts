/**
 * Текст, разложенный по времени звука.
 *
 * Модуль намеренно ничего не знает ни о Payload, ни о Next, ни о нашем
 * разборе SSML: на входе — куски с длительностями, на выходе — фразы
 * с временами и стандартный WebVTT. Это единственная причина, по которой
 * его можно будет вынуть в отдельный пакет, не разбирая по частям.
 *
 * Откуда берутся длительности — забота вызывающего. У нас их два источника:
 * точные (посчитанные по кадрам MP3 при синтезе, кусок за куском) и
 * приблизительные (общая длительность, разложенная по длине текста).
 * Второй нужен для озвучек, сделанных до появления этой возможности.
 */

export interface Cue {
  /** Секунды от начала файла */
  start: number;
  end: number;
  text: string;
  /** Кто говорит, если известно. Показывается над фразой */
  speaker: string | null;
}

export type TimedItem =
  | { kind: "speech"; text: string; speaker: string | null; seconds: number }
  | { kind: "silence"; seconds: number };

/**
 * Сокращения, после которых точка не кончает предложение.
 *
 * Список короткий и неполный намеренно: полного не бывает, а каждая лишняя
 * запись — это риск склеить два настоящих предложения. Ошибка в сторону
 * «разрезали лишний раз» безобиднее: получится две короткие фразы вместо
 * одной, и по ним всё равно можно щёлкнуть.
 */
const ABBREVIATIONS = [
  "mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "no", "fig",
  "тыс", "млн", "млрд", "им", "гг", "др", "т.д", "т.п", "т.е",
];

const ABBREV_RE = new RegExp(
  `(?:\\b(?:${ABBREVIATIONS.map((a) => a.replace(/\./g, "\\.")).join("|")})|\\b\\p{Lu})\\.$`,
  "iu",
);

/**
 * Сколько символов считаем пределом для одной фразы.
 *
 * Речь идёт около 16,6 символов в секунду (замерено на настоящей озвучке),
 * то есть 250 символов — примерно пятнадцать секунд. Дольше — уже не «вот
 * это место», а «где-то в этом куске»: щёлкнув, человек попадает в начало
 * и переслушивает лишнее.
 *
 * Предел нужен потому, что модель пишет предложения по шестьсот символов:
 * в настоящем скрипте нашлось одно на 35 секунд. По одним точкам такое
 * не разбивается.
 */
const MAX_CUE_CHARS = 250;

/**
 * Границы, по которым долгое предложение делится на части, в порядке
 * предпочтения. Точка с запятой и двоеточие — почти конец мысли, тире
 * и запятая — хуже, но лучше, чем тридцатипятисекундная простыня.
 */
const CLAUSE_BREAKS = [/;\s+/g, /:\s+/g, /\s+[—–]\s+/g, /,\s+/g];

/**
 * Дробление слишком длинной фразы по смысловым границам.
 *
 * Режем по одной границе, ближайшей к середине: так обе половины выходят
 * сопоставимыми, и рекурсия быстро сходится. Резать по всем границам подряд
 * нельзя — получилась бы россыпь из двух слов.
 */
function splitLong(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  for (const pattern of CLAUSE_BREAKS) {
    const points: number[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      points.push(match.index + match[0].length);
    }
    if (!points.length) continue;

    const middle = text.length / 2;
    const at = points.reduce((best, point) =>
      Math.abs(point - middle) < Math.abs(best - middle) ? point : best,
    );
    // Граница у самого края делу не поможет: одна часть останется длинной.
    if (at < limit / 4 || text.length - at < limit / 4) continue;

    return [
      ...splitLong(text.slice(0, at).trim(), limit),
      ...splitLong(text.slice(at).trim(), limit),
    ];
  }

  // Смысловых границ нет вовсе — оставляем как есть. Рубить по словам
  // значило бы показать человеку обрывок без начала и конца.
  return [text];
}

/**
 * Разбивка на фразы для навигации.
 *
 * Сначала по концам предложений: точка, восклицательный или вопросительный
 * знак, за которыми пробел и заглавная буква либо цифра. Инициалы
 * («J. Smith») и сокращения из списка выше не режем. Затем слишком длинные
 * предложения дробятся по смысловым границам.
 */
export function splitSentences(text: string, limit = MAX_CUE_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const out: string[] = [];
  let start = 0;

  // Ищем знак конца, за которым пробел и начало нового предложения.
  const boundary = /([.!?…]+["»”')\]]?)\s+(?=[\p{Lu}\p{Nd}"«“(\[])/gu;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(normalized)) !== null) {
    const candidate = normalized.slice(start, match.index + match[1].length);
    // «Dr.» и «J.» — не конец предложения, идём дальше.
    if (ABBREV_RE.test(candidate.trimEnd())) continue;
    out.push(candidate.trim());
    start = boundary.lastIndex;
  }

  const tail = normalized.slice(start).trim();
  if (tail) out.push(tail);

  return out.flatMap((sentence) => splitLong(sentence, limit));
}

/** Сколько «говорения» в строке. Пробелы не произносятся. */
const weightOf = (text: string): number => text.replace(/\s+/g, "").length || 1;

/**
 * Фразы с временами.
 *
 * Внутри куска время раскладывается пропорционально длине предложений.
 * Это приблизительно: числа и аббревиатуры произносятся дольше, чем весят
 * в символах. Зато ошибка не накапливается — границы кусков точны, и на
 * каждой следующей реплике отсчёт начинается заново.
 */
export function buildCues(items: TimedItem[]): Cue[] {
  const cues: Cue[] = [];
  let clock = 0;

  for (const item of items) {
    if (item.kind === "silence") {
      clock += item.seconds;
      continue;
    }

    const sentences = splitSentences(item.text);
    if (!sentences.length) {
      clock += item.seconds;
      continue;
    }

    const total = sentences.reduce((sum, sentence) => sum + weightOf(sentence), 0);
    let offset = 0;

    sentences.forEach((sentence, index) => {
      const share = (weightOf(sentence) / total) * item.seconds;
      const start = clock + offset;
      // Последнюю фразу дотягиваем до конца куска, чтобы округления
      // не оставили щели перед точной границей следующей реплики.
      const end = index === sentences.length - 1 ? clock + item.seconds : start + share;
      cues.push({ start, end, text: sentence, speaker: item.speaker });
      offset += share;
    });

    clock += item.seconds;
  }

  return cues;
}

/**
 * Разложить известную общую длительность по кускам.
 *
 * Для озвучек, сделанных до появления карты времени: точных длительностей
 * кусков у них нет, но паузы известны из скрипта, а остаток времени —
 * это речь. Раскладываем его по длине текста.
 *
 * Границы реплик здесь тоже приблизительны, и ошибка НАКАПЛИВАЕТСЯ — в этом
 * вся разница с точным путём. Годится, чтобы найти место и переслушать;
 * не годится, чтобы говорить «подсветка точна».
 */
export function estimateDurations(
  items: readonly TimedItem[],
  totalSeconds: number,
): TimedItem[] {
  const silence = items.reduce((sum, item) => (item.kind === "silence" ? sum + item.seconds : sum), 0);
  const speechTime = Math.max(0, totalSeconds - silence);
  const speechWeight = items.reduce(
    (sum, item) => (item.kind === "speech" ? sum + weightOf(item.text) : sum),
    0,
  );

  return items.map((item) =>
    item.kind === "silence"
      ? item
      : { ...item, seconds: speechWeight ? (weightOf(item.text) / speechWeight) * speechTime : 0 },
  );
}

/** Имя в `<v ...>` не может содержать `>` и переводов строк. */
const vttName = (speaker: string): string =>
  speaker.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();

/** Обратная операция: достать говорящего и чистый текст из фразы VTT. */
export function parseVoice(text: string): { speaker: string | null; text: string } {
  const match = /^<v\s+([^>]*)>([\s\S]*?)<\/v>$/.exec(text.trim());
  if (!match) return { speaker: null, text: text.trim() };
  return { speaker: match[1].trim() || null, text: match[2].trim() };
}

const stamp = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

/**
 * WebVTT — стандарт, а не наш формат.
 *
 * Браузер разбирает его сам: `<track kind="metadata" src="...">` даёт
 * готовые `cues` и событие `cuechange`. Поэтому разбора в коде нет вовсе,
 * а файл годится для любого другого проигрывателя.
 *
 * Имя говорящего идёт стандартной голосовой разметкой `<v Имя>текст</v>`.
 * Блок `NOTE` для этого не годится: по спецификации он отдельный блок,
 * а не строка внутри фразы, и вставленный между номером и временем делает
 * файл невалидным — браузер молча не разберёт ни одной фразы.
 */
export function toVtt(cues: Cue[]): string {
  const lines = ["WEBVTT", ""];

  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${stamp(cue.start)} --> ${stamp(cue.end)}`);
    lines.push(cue.speaker ? `<v ${vttName(cue.speaker)}>${cue.text}</v>` : cue.text);
    lines.push("");
  });

  return lines.join("\n");
}
