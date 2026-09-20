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

/**
 * Пауза, найденная в звуке. Приходит снаружи числами — модуль по-прежнему
 * ничего не знает ни о MP3, ни о том, кто и чем его декодировал.
 */
export interface Pause {
  time: number;
  length: number;
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

/**
 * Убрать подпись говорящего из начала реплики.
 *
 * В скрипте реплика начинается с «Moderator: …», и озвучка это произносит —
 * значит текст обязан совпадать со звуком. Но показывать подпись дважды
 * (заголовком над репликой и в первой же фразе) незачем: читать так тяжелее,
 * а цель всей затеи ровно обратная.
 *
 * Убираем ТОЛЬКО точное совпадение с известным говорящим. «Elena Vance:»
 * внутри реплики — часть речи, её трогать нельзя: её произносят, и без неё
 * человек не поймёт, кого назвали.
 */
const dropSpeakerPrefix = (text: string, speaker: string | null): string => {
  if (!speaker) return text;
  const prefix = `${speaker.trim()}:`;
  return text.trimStart().toLowerCase().startsWith(prefix.toLowerCase())
    ? text.trimStart().slice(prefix.length).trimStart()
    : text;
};

/** Сколько «говорения» в строке. Пробелы не произносятся. */
const weightOf = (text: string): number => text.replace(/\s+/g, "").length || 1;

/**
 * Фразы с временами.
 *
 * Границы кусков точны — они известны по кадрам MP3. Внутри куска время
 * сначала раскладывается пропорционально длине предложений, а потом
 * границы притягиваются к настоящим паузам в звуке, если они переданы.
 *
 * Зачем притягивать. Раскладка по длине держится на допущении, что речь
 * идёт с постоянным числом символов в секунду, а она так не идёт: на
 * настоящей озвучке между голосами разброс оказался в 1,7 раза, и на
 * реплике в минуту подсветка убегала вперёд на десяток секунд. Пауза же
 * в звуке — это ровно та граница, которую человек слышит.
 */
export function buildCues(items: TimedItem[], pauses: Pause[] = []): Cue[] {
  const cues: Cue[] = [];
  let clock = 0;

  for (const item of items) {
    if (item.kind === "silence") {
      clock += item.seconds;
      continue;
    }

    const sentences = splitSentences(dropSpeakerPrefix(item.text, item.speaker));
    if (!sentences.length) {
      clock += item.seconds;
      continue;
    }

    const from = clock;
    const to = clock + item.seconds;
    const total = sentences.reduce((sum, sentence) => sum + weightOf(sentence), 0);

    // Предсказание по длине: оно же — опора для выравнивания ниже.
    const predicted: number[] = [];
    let offset = 0;
    for (let i = 0; i < sentences.length - 1; i++) {
      offset += (weightOf(sentences[i]) / total) * item.seconds;
      predicted.push(from + offset);
    }

    const bounds = [from, ...alignToPauses(predicted, pauses, from, to), to];
    sentences.forEach((sentence, index) => {
      cues.push({
        start: bounds[index],
        // Фраза кончается там, где начинается следующая: разрыв между ними
        // означал бы мгновение без подсветки, а пауза — часть той фразы,
        // после которой человек её слышит.
        end: bounds[index + 1],
        text: sentence,
        speaker: item.speaker,
      });
    });

    clock = to;
  }

  return cues;
}

/** Дальше этого от предсказания паузу не ищем: это уже другая фраза. */
const SNAP_TOLERANCE_SEC = 3.5;

/**
 * Плата за отказ от привязки.
 *
 * Без неё выравнивание цеплялось бы за любую паузу, лишь бы ближе. С ней
 * оно предпочитает оставить границу на предсказанном месте, если рядом
 * нет ничего убедительного.
 */
const SKIP_COST = 1.2;

/** Награда за длину паузы: конец предложения звучит дольше запятой. */
const LENGTH_BONUS = 4;

/** Насколько фраза может сжаться и растянуться против предсказания. */
const MIN_SHARE = 0.55;
const MAX_SHARE = 1.8;

/**
 * Границы фраз, притянутые к настоящим паузам в звуке.
 *
 * Почему не «ближайшая пауза к каждой границе» по отдельности: пауз в
 * реплике втрое больше, чем предложений, — синтез делает их и на запятых.
 * Жадный выбор ставил границы вразнобой и однажды переставил их местами,
 * дав фразу отрицательной длины. Поэтому раскладка считается целиком:
 * выбирается возрастающая последовательность пауз, у которой суммарное
 * отклонение от предсказания наименьшее.
 *
 * Это динамическое программирование по (граница, кандидат). Предложений
 * в реплике меньше двадцати, кандидатов — меньше полусотни, так что
 * точное решение дешевле любой эвристики.
 */
export function alignToPauses(
  predicted: number[],
  pauses: Pause[],
  from: number,
  to: number,
): number[] {
  if (!predicted.length) return [];

  type Candidate = { time: number; base: number; only: number };
  const inside = pauses.filter((pause) => pause.time > from && pause.time < to);
  const candidates: Candidate[] = [
    ...inside.map((pause) => ({
      time: pause.time,
      base: -LENGTH_BONUS * Math.min(pause.length, 0.6),
      only: -1,
    })),
    // Предсказанные места — тоже кандидаты, со своей платой: так «не
    // привязывать» остаётся возможным исходом, а не аварийным.
    ...predicted.map((time, index) => ({ time, base: SKIP_COST, only: index })),
  ].sort((a, b) => a.time - b.time);

  const edges = [from, ...predicted, to];
  const want = (index: number): number => edges[index + 1] - edges[index];
  const fits = (index: number, previous: number, time: number): boolean => {
    const span = time - previous;
    return span >= MIN_SHARE * want(index) && span <= MAX_SHARE * want(index);
  };

  const INF = Number.POSITIVE_INFINITY;
  const cost = (index: number, j: number): number => {
    const candidate = candidates[j];
    if (candidate.only >= 0 && candidate.only !== index) return INF;
    const distance = Math.abs(candidate.time - predicted[index]);
    return distance > SNAP_TOLERANCE_SEC ? INF : distance + candidate.base;
  };

  const n = predicted.length;
  const m = candidates.length;
  const best: number[][] = Array.from({ length: n }, () => new Array(m).fill(INF));
  const from_: number[][] = Array.from({ length: n }, () => new Array(m).fill(-1));

  for (let j = 0; j < m; j++) {
    const c = cost(0, j);
    if (c < INF && fits(0, from, candidates[j].time)) best[0][j] = c;
  }

  for (let i = 1; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const c = cost(i, j);
      if (c === INF) continue;
      for (let k = 0; k < j; k++) {
        if (best[i - 1][k] === INF) continue;
        if (!fits(i, candidates[k].time, candidates[j].time)) continue;
        const total = best[i - 1][k] + c;
        if (total < best[i][j]) {
          best[i][j] = total;
          from_[i][j] = k;
        }
      }
    }
  }

  let end = -1;
  let endCost = INF;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] >= endCost) continue;
    if (!fits(n, candidates[j].time, to)) continue;
    endCost = best[n - 1][j];
    end = j;
  }
  // Ничего согласованного не нашлось — предсказание и есть ответ.
  if (end < 0) return predicted;

  const result = new Array<number>(n);
  let j = end;
  for (let i = n - 1; i >= 0; i--) {
    result[i] = candidates[j].time;
    j = from_[i][j];
  }
  return result;
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

/**
 * Пересчёт готовой карты времени по паузам в звуке.
 *
 * Нужен для озвучек, сделанных до появления привязки: платить за новый
 * синтез ради исправления подсветки человек не должен, а всё необходимое
 * уже есть — точные границы реплик лежат в самой карте.
 *
 * Разбор своего же формата здесь единственный в модуле и намеренно
 * минимальный: берём времена и текст, остальное не трогаем.
 */
export function realignVtt(vtt: string, pauses: Pause[]): string | null {
  const parsed = parseVtt(vtt);
  if (!parsed.length) return null;

  // Реплики отделены друг от друга паузой: между их фразами есть зазор.
  const chunks: Cue[][] = [];
  let current: Cue[] = [parsed[0]];
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].start - parsed[i - 1].end > 0.05) {
      chunks.push(current);
      current = [parsed[i]];
    } else {
      current.push(parsed[i]);
    }
  }
  chunks.push(current);

  const out: Cue[] = [];
  for (const chunk of chunks) {
    const from = chunk[0].start;
    const to = chunk[chunk.length - 1].end;
    // Границы, которые уже стоят, и есть предсказание: они посчитаны
    // по длине текста при синтезе.
    const predicted = chunk.slice(1).map((cue) => cue.start);
    const bounds = [from, ...alignToPauses(predicted, pauses, from, to), to];
    chunk.forEach((cue, index) => {
      out.push({ ...cue, start: bounds[index], end: bounds[index + 1] });
    });
  }

  return toVtt(out);
}

const parseVtt = (vtt: string): Cue[] => {
  const seconds = (stampText: string): number => {
    const parts = stampText.trim().split(":");
    const s = parseFloat(parts.pop() ?? "0");
    const m = parseInt(parts.pop() ?? "0", 10);
    const h = parseInt(parts.pop() ?? "0", 10);
    return h * 3600 + m * 60 + s;
  };

  const cues: Cue[] = [];
  for (const block of vtt.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const [left, right] = timing.split("-->");
    const body = lines.slice(lines.indexOf(timing) + 1).join("\n").trim();
    if (!body) continue;
    const voice = parseVoice(body);
    cues.push({ start: seconds(left), end: seconds(right), text: voice.text, speaker: voice.speaker });
  }
  return cues;
};
