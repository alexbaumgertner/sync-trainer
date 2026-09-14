/**
 * Изоморфный (браузер + сервер) разбор и нарезка SSML-скрипта.
 *
 * Зачем нарезка: у Google Cloud TTS жёсткий лимит 5000 БАЙТ на один запрос
 * synthesize (считаются и SSML-теги тоже). Скрипт панели на 20 минут — это
 * ~17 000 символов, т.е. 4-5 запросов, которые потом склеиваются в один файл.
 */

export const GOOGLE_MAX_INPUT_BYTES = 5000;
/** Запас на случай, если Google считает байты чуть иначе. */
export const DEFAULT_CHUNK_BYTES = 4600;

const encoder = new TextEncoder();
export const byteLen = (s: string): number => encoder.encode(s).length;

export type Block =
  | { kind: "p"; speaker: string | null; body: string }
  | { kind: "break"; time: string };

/** "Moderator: ...", "Audience Member 1: ..." в начале абзаца. */
const SPEAKER_RE = /^\s*([\p{Lu}][^<>:\n]{0,40}?)\s*:\s+/u;

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface ParsedScript {
  blocks: Block[];
  /** rate из внешнего <prosody rate="105%">, если он был */
  rate: string | null;
  /** во входных данных была SSML-разметка (а не просто текст) */
  hadMarkup: boolean;
}

export function parseScript(input: string): ParsedScript {
  let src = input.trim();
  let rate: string | null = null;

  const speak = src.match(/<speak[^>]*>([\s\S]*)<\/speak>/i);
  if (speak) src = speak[1];

  const prosody = src.match(/^\s*<prosody([^>]*)>([\s\S]*)<\/prosody>\s*$/i);
  if (prosody) {
    rate = prosody[1].match(/rate\s*=\s*"([^"]+)"/i)?.[1] ?? null;
    src = prosody[2];
  }

  const hadMarkup = /<(p|break|s|prosody|emphasis|say-as|sub|phoneme|mark|voice)\b/i.test(src);

  if (!hadMarkup) {
    // Обычный текст: абзацы по пустой строке.
    const blocks = src
      .split(/\n\s*\n+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map<Block>((t) => makeParagraph(escapeXml(t.replace(/\s*\n\s*/g, " "))));
    return { blocks, rate, hadMarkup };
  }

  const blocks: Block[] = [];
  const token = /<p\b[^>]*>([\s\S]*?)<\/p>|<break\b([^>]*?)\/?>/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;

  const pushLoose = (text: string) => {
    const t = text.trim();
    if (t) blocks.push(makeParagraph(t.replace(/\s*\n\s*/g, " ")));
  };

  while ((m = token.exec(src)) !== null) {
    pushLoose(src.slice(cursor, m.index));
    if (m[1] !== undefined) {
      const body = m[1].trim().replace(/\s*\n\s*/g, " ");
      if (body) blocks.push(makeParagraph(body));
    } else {
      const time = m[2]?.match(/time\s*=\s*"([^"]+)"/i)?.[1] ?? "500ms";
      blocks.push({ kind: "break", time });
    }
    cursor = token.lastIndex;
  }
  pushLoose(src.slice(cursor));

  return { blocks, rate, hadMarkup };
}

function makeParagraph(body: string): Block {
  const speaker = body.match(SPEAKER_RE)?.[1]?.trim() ?? null;
  return { kind: "p", speaker, body };
}

export function renderBlock(block: Block, stripLabels: boolean): string {
  if (block.kind === "break") return `<break time="${block.time}"/>`;
  let body = block.body.trim();
  if (stripLabels && block.speaker) body = body.replace(SPEAKER_RE, "");
  return `<p>${body}</p>`;
}

/* ------------------------------------------------------------------ */
/* Нарезка                                                             */
/* ------------------------------------------------------------------ */

export interface Chunk {
  ssml: string;
  /** какой голос озвучивает кусок (null — нейтральный/один голос) */
  speaker: string | null;
  bytes: number;
  /** символы, за которые Google выставит счёт (теги тоже считаются) */
  billableChars: number;
}

export interface ChunkOptions {
  rate?: string | null;
  /** не смешивать реплики разных спикеров в одном запросе */
  perSpeaker?: boolean;
  /** убирать "Moderator:" из произносимого текста */
  stripLabels?: boolean;
  maxBytes?: number;
}

export function planChunks(blocks: Block[], opts: ChunkOptions = {}): Chunk[] {
  const {
    rate = null,
    perSpeaker = false,
    stripLabels = false,
    maxBytes = DEFAULT_CHUNK_BYTES,
  } = opts;

  const open = rate ? `<speak><prosody rate="${rate}">` : "<speak>";
  const close = rate ? "</prosody></speak>" : "</speak>";
  const budget = maxBytes - byteLen(open) - byteLen(close);
  if (budget < 200) throw new Error("maxBytes слишком мал");

  const chunks: Chunk[] = [];
  let parts: string[] = [];
  let bytes = 0;
  let speaker: string | null = null;
  // Паузу между репликами держим "в руках": если на ней происходит смена
  // спикера, она должна уехать в следующий кусок, а не повиснуть хвостом.
  let pendingBreak: string | null = null;

  const flush = () => {
    if (!parts.length) return;
    const ssml = open + parts.join("") + close;
    chunks.push({ ssml, speaker, bytes: byteLen(ssml), billableChars: ssml.length });
    parts = [];
    bytes = 0;
  };

  for (const block of blocks) {
    if (block.kind === "break") {
      pendingBreak = renderBlock(block, stripLabels);
      continue;
    }

    if (perSpeaker && parts.length && speaker !== block.speaker) flush();

    const pieces = splitToFit(block, stripLabels, budget);
    for (const piece of pieces) {
      const lead = pendingBreak ?? "";
      const size = byteLen(lead) + byteLen(piece);
      if (parts.length && bytes + size > budget) flush();
      if (!parts.length) speaker = block.speaker;
      if (lead) parts.push(lead);
      parts.push(piece);
      bytes += size;
      pendingBreak = null;
    }
  }
  flush();
  // Висящий в конце <break> отбрасываем — тишина в хвосте файла не нужна.
  return chunks;
}

/** Абзац длиннее лимита режем по предложениям, в крайнем случае по словам. */
function splitToFit(
  block: Extract<Block, { kind: "p" }>,
  stripLabels: boolean,
  budget: number,
): string[] {
  const rendered = renderBlock(block, stripLabels);
  if (byteLen(rendered) <= budget) return [rendered];

  let body = block.body.trim();
  if (stripLabels && block.speaker) body = body.replace(SPEAKER_RE, "");

  const sentences = body.match(/[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g) ?? [body];
  const out: string[] = [];
  let buf = "";
  const inner = budget - byteLen("<p></p>");

  const push = () => {
    if (buf.trim()) out.push(`<p>${buf.trim()}</p>`);
    buf = "";
  };

  for (const sentence of sentences) {
    if (byteLen(sentence) > inner) {
      push();
      for (const word of sentence.split(/(?<=\s)/)) {
        if (byteLen(buf + word) > inner) push();
        buf += word;
      }
      push();
      continue;
    }
    if (buf && byteLen(buf + sentence) > inner) push();
    buf += sentence;
  }
  push();
  return out;
}

/* ------------------------------------------------------------------ */
/* План синтеза: SSML-режим и text-режим                               */
/* ------------------------------------------------------------------ */

/**
 * Chirp 3 HD / Journey звучат заметно естественнее, но SSML не принимают
 * вообще. Чтобы получить с ними те же паузы, разметку убираем, а <break>
 * превращаем в реальную тишину, которая вставляется при склейке.
 */
export type SynthesisFormat = "ssml" | "text";

export type PlanItem =
  | {
      type: "speech";
      format: SynthesisFormat;
      /** SSML-документ или plain text — то, что уйдёт в input */
      content: string;
      speaker: string | null;
      bytes: number;
      billableChars: number;
    }
  | { type: "silence"; seconds: number };

export interface PlanOptions extends ChunkOptions {
  format?: SynthesisFormat;
}

export function planSynthesis(blocks: Block[], opts: PlanOptions = {}): PlanItem[] {
  if ((opts.format ?? "ssml") === "ssml") {
    return planChunks(blocks, opts).map<PlanItem>((chunk) => ({
      type: "speech",
      format: "ssml",
      content: chunk.ssml,
      speaker: chunk.speaker,
      bytes: chunk.bytes,
      billableChars: chunk.billableChars,
    }));
  }
  return planTextItems(blocks, opts);
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Абзац → чистый текст: теги долой, сущности обратно, метка спикера по флагу. */
export function toPlainText(block: Extract<Block, { kind: "p" }>, stripLabels: boolean): string {
  let body = block.body.trim();
  if (stripLabels && block.speaker) body = body.replace(SPEAKER_RE, "");
  return unescapeXml(body.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function planTextItems(blocks: Block[], opts: PlanOptions): PlanItem[] {
  const { perSpeaker = false, stripLabels = false, maxBytes = DEFAULT_CHUNK_BYTES } = opts;
  const items: PlanItem[] = [];

  let parts: string[] = [];
  let speaker: string | null = null;
  let bytes = 0;
  let pendingSilence = 0;

  const flush = () => {
    if (!parts.length) return;
    const content = parts.join("\n\n");
    items.push({
      type: "speech",
      format: "text",
      content,
      speaker,
      bytes: byteLen(content),
      billableChars: content.length,
    });
    parts = [];
    bytes = 0;
  };

  const emitSilence = () => {
    if (pendingSilence > 0) items.push({ type: "silence", seconds: pendingSilence });
    pendingSilence = 0;
  };

  for (const block of blocks) {
    if (block.kind === "break") {
      pendingSilence += parseBreak(block.time);
      continue;
    }

    const text = toPlainText(block, stripLabels);
    if (!text) continue;

    // Тишина — это отдельный кусок аудио, поэтому речевой кусок перед ней
    // обязан закончиться: иначе пауза уедет не на своё место.
    if (pendingSilence > 0) {
      flush();
      emitSilence();
    }
    if (perSpeaker && parts.length && speaker !== block.speaker) flush();

    for (const piece of splitPlainToFit(text, maxBytes)) {
      const size = byteLen(piece) + (parts.length ? 2 : 0);
      if (parts.length && bytes + size > maxBytes) flush();
      if (!parts.length) speaker = block.speaker;
      parts.push(piece);
      bytes += size;
    }
  }
  flush();
  // Висящую в конце паузу отбрасываем — тишина в хвосте файла не нужна.
  return items;
}

function splitPlainToFit(text: string, budget: number): string[] {
  if (byteLen(text) <= budget) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["'\u201d\u2019)\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const sentence of sentences) {
    if (byteLen(sentence) > budget) {
      push();
      for (const word of sentence.split(/(?<=\s)/)) {
        if (byteLen(buf + word) > budget) push();
        buf += word;
      }
      push();
      continue;
    }
    if (buf && byteLen(buf + sentence) > budget) push();
    buf += sentence;
  }
  push();
  return out;
}

/* ------------------------------------------------------------------ */
/* Аналитика для UI                                                    */
/* ------------------------------------------------------------------ */

export interface ScriptStats {
  speakers: string[];
  paragraphs: number;
  /** символы произносимого текста, без тегов */
  spokenChars: number;
  /** суммарная длительность <break> в секундах */
  breakSeconds: number;
  estimatedSeconds: number;
}

/** Примерно 14 символов в секунду для английской речи на скорости 100%. */
const CHARS_PER_SECOND = 14;

export function analyzeScript(
  blocks: Block[],
  rate: string | null,
  opts: { stripLabels?: boolean } = {},
): ScriptStats {
  const speakers: string[] = [];
  let spokenChars = 0;
  let breakSeconds = 0;
  let paragraphs = 0;

  for (const block of blocks) {
    if (block.kind === "break") {
      breakSeconds += parseBreak(block.time);
      continue;
    }
    paragraphs += 1;
    if (block.speaker && !speakers.includes(block.speaker)) speakers.push(block.speaker);
    // В режиме разных голосов метка спикера не произносится — значит и в оценку
    // длительности попадать не должна, иначе она завышена на каждой реплике.
    let spoken = block.body.replace(/<[^>]+>/g, "");
    if (opts.stripLabels && block.speaker) spoken = spoken.replace(SPEAKER_RE, "");
    spokenChars += spoken.length;
  }

  const multiplier = rate ? (parseFloat(rate) || 100) / 100 : 1;
  const estimatedSeconds = spokenChars / CHARS_PER_SECOND / multiplier + breakSeconds;
  return { speakers, paragraphs, spokenChars, breakSeconds, estimatedSeconds };
}

function parseBreak(time: string): number {
  const m = time.match(/^([\d.]+)\s*(ms|s)?$/i);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  return m[2]?.toLowerCase() === "ms" ? value / 1000 : value;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Проверка перед синтезом (G2)                                        */
/* ------------------------------------------------------------------ */

/** Теги, которые Google принимает в SSML. Остальное — повод отказать заранее. */
const ALLOWED_TAGS = new Set([
  "speak",
  "p",
  "s",
  "break",
  "prosody",
  "emphasis",
  "say-as",
  "sub",
  "phoneme",
  "mark",
  "voice",
  "audio",
  "lang",
  "par",
  "seq",
  "media",
]);

export interface SsmlValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** План синтеза, если разметка пригодна */
  plan: PlanItem[];
  billableChars: number;
  estimatedSeconds: number;
}

/**
 * Проверяем разметку ДО обращения к Google: отказ после оплаченного запроса
 * бесполезен, а ошибки здесь дешёвые и понятные.
 */
export function validateForSynthesis(
  ssml: string,
  opts: PlanOptions & { maxBytes?: number } = {},
): SsmlValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty = { plan: [] as PlanItem[], billableChars: 0, estimatedSeconds: 0 };

  const text = ssml?.trim() ?? "";
  if (!text) {
    return { ok: false, errors: ["Разметка пуста — синтезировать нечего."], warnings, ...empty };
  }

  if (!/^<speak[\s>]/i.test(text)) {
    errors.push("Разметка не начинается с <speak>.");
  }
  if (!/<\/speak>\s*$/i.test(text)) {
    errors.push("Разметка не заканчивается на </speak>.");
  }

  const unknown = new Set<string>();
  for (const match of text.matchAll(/<\/?([a-zA-Z][\w-]*)/g)) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) unknown.add(tag);
  }
  if (unknown.size) {
    errors.push(`Google не примет теги: ${[...unknown].join(", ")}.`);
  }

  // Грубая проверка парности: Google отклонит незакрытый тег, но уже за деньги.
  for (const tag of ["speak", "prosody", "p"]) {
    const open = (text.match(new RegExp(`<${tag}(?=[\\s>])`, "gi")) ?? []).length;
    const close = (text.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
    if (open !== close) {
      errors.push(`Тег <${tag}> открыт ${open} раз, закрыт ${close}.`);
    }
  }

  if (errors.length) return { ok: false, errors, warnings, ...empty };

  let parsed: ParsedScript;
  let plan: PlanItem[];
  try {
    parsed = parseScript(text);
    plan = planSynthesis(parsed.blocks, opts);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message], warnings, ...empty };
  }

  const speech = plan.filter((item) => item.type === "speech");
  if (!speech.length) {
    return {
      ok: false,
      errors: ["Из разметки не получилось ни одного куска для синтеза."],
      warnings,
      ...empty,
    };
  }

  const oversized = speech.filter((item) => item.bytes > GOOGLE_MAX_INPUT_BYTES);
  if (oversized.length) {
    errors.push(
      `${oversized.length} кусков превышают лимит Google в ${GOOGLE_MAX_INPUT_BYTES} байт.`,
    );
  }

  const stats = analyzeScript(parsed.blocks, opts.rate ?? parsed.rate, {
    stripLabels: opts.stripLabels,
  });
  if (stats.paragraphs === 0) warnings.push("В разметке нет ни одного абзаца <p>.");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    plan,
    billableChars: speech.reduce((sum, item) => sum + item.billableChars, 0),
    estimatedSeconds: stats.estimatedSeconds,
  };
}
