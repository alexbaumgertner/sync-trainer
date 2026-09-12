/**
 * Дымовой тест пайплайна без обращения к Google.
 * Проверяет разбор скрипта, оба режима нарезки, лимит 5000 байт,
 * очистку разметки в text-режиме и валидность склеенной тишины.
 *
 *   node scripts/smoke.mjs [путь-к-скрипту]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Mp3Encoder } from "@breezystack/lamejs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parseScript, planSynthesis, analyzeScript, formatDuration } = await import(
  path.join(root, "src/lib/ssml.ts")
);

const file = process.argv[2] ?? path.join(root, "public/examples/panel.ssml");
const parsed = parseScript(fs.readFileSync(file, "utf8"));
const stats = analyzeScript(parsed.blocks, parsed.rate);

console.log(`Файл: ${path.relative(root, file)}`);
console.log(`Спикеры (${stats.speakers.length}): ${stats.speakers.join(", ")}`);
console.log(`Абзацев ${stats.paragraphs}, пауз ${stats.breakSeconds}s, звучание ≈ ${formatDuration(stats.estimatedSeconds)}\n`);

let failed = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
};

for (const format of ["ssml", "text"]) {
  for (const perSpeaker of [false, true]) {
    const plan = planSynthesis(parsed.blocks, {
      format,
      rate: parsed.rate,
      perSpeaker,
      stripLabels: perSpeaker,
      maxBytes: 4600,
    });
    const speech = plan.filter((i) => i.type === "speech");
    const silence = plan.filter((i) => i.type === "silence");
    const maxBytes = Math.max(...speech.map((i) => i.bytes));

    console.log(`${format} / ${perSpeaker ? "разные голоса" : "один голос"}: ` +
      `${speech.length} запросов, ${silence.length} пауз, макс ${maxBytes}B, ` +
      `${speech.reduce((s, i) => s + i.billableChars, 0)} симв.`);

    check(maxBytes <= 5000, "ни один кусок не превышает лимит Google в 5000 байт");
    check(speech.length > 0, "план не пустой");

    if (format === "text") {
      check(!speech.some((i) => /<[^>]+>/.test(i.content)), "разметка вычищена");
      check(!speech.some((i) => /&(amp|lt|gt|quot|apos);/.test(i.content)), "XML-сущности раскрыты");
      check(silence.length > 0, "паузы вынесены в отдельные элементы плана");
    } else {
      check(silence.length === 0, "в SSML-режиме паузы остаются внутри запроса");
      check(speech.every((i) => i.content.startsWith("<speak>")), "каждый кусок — валидный документ");
    }
    if (perSpeaker) {
      check(
        speech.every((i) => !/^(Moderator|Researcher|Youth Activist|Donor Rep|NGO Rep|Audience Member)/.test(
          i.content.replace(/^<speak>(<prosody[^>]*>)?<p>/, ""))),
        "метки спикеров не произносятся",
      );
    }
    console.log();
  }
}

/* --- тишина --- */
function silenceMp3(seconds, sampleRate = 24000) {
  const total = Math.max(0, Math.round(seconds * sampleRate) - 1440);
  const enc = new Mp3Encoder(1, sampleRate, 64);
  const quiet = new Int16Array(1152);
  const parts = [];
  for (let i = 0; i < total; i += 1152) {
    const frame = enc.encodeBuffer(quiet.subarray(0, Math.min(1152, total - i)));
    if (frame.length) parts.push(Buffer.from(frame));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

const textPlan = planSynthesis(parsed.blocks, { format: "text", perSpeaker: true, stripLabels: true });
const silences = textPlan.filter((i) => i.type === "silence");
const chain = Buffer.concat(silences.map((i) => silenceMp3(i.seconds)));
const out = path.join(root, ".next", "smoke-silence.mp3");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, chain);
console.log(`Тишина: ${silences.length} пауз склеено в ${chain.length} байт -> ${path.relative(root, out)}`);
check(chain.subarray(0, 2).toString("hex") === "fff3", "склейка начинается с валидного MPEG-2 Layer III фрейма");

console.log(failed ? `\n${failed} проверок упало` : "\nВсе проверки пройдены");
process.exit(failed ? 1 : 0);
