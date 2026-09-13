/**
 * Минимальный тег ID3v2.3 для MP3.
 *
 * Требование G5: материал синтетический, и пометка должна быть не только
 * в интерфейсе, но и в самом файле. Скрипт помечается текстом, а у аудио
 * для этого есть единственное подходящее место — метаданные.
 *
 * Готовая библиотека здесь избыточна: нам нужны два текстовых кадра.
 */

const encodeText = (value: string): Buffer =>
  // 0x01 — UTF-16 с BOM: только так ID3v2.3 гарантирует кириллицу
  Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(value, "utf16le"),
    Buffer.from([0x00, 0x00]),
  ]);

function frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  header.writeUInt32BE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

function commentFrame(text: string): Buffer {
  // COMM: язык, пустое короткое описание, затем сам текст
  const body = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from("rus", "latin1"),
    Buffer.from([0xff, 0xfe, 0x00, 0x00]),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, "utf16le"),
    Buffer.from([0x00, 0x00]),
  ]);
  return frame("COMM", body);
}

/** Размер тега пишется «синхробезопасными» семибитными группами. */
function synchsafe(size: number): Buffer {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

export function withId3(mp3: Buffer, meta: { title: string; comment: string }): Buffer {
  const frames = Buffer.concat([
    frame("TIT2", encodeText(meta.title)),
    frame("TPE1", encodeText("Тренажёр синхрониста")),
    commentFrame(meta.comment),
  ]);

  const header = Buffer.concat([
    Buffer.from("ID3", "latin1"),
    Buffer.from([0x03, 0x00]), // версия 2.3.0
    Buffer.from([0x00]), // без флагов
    synchsafe(frames.byteLength),
  ]);

  return Buffer.concat([header, frames, mp3]);
}

export const SYNTHETIC_NOTICE =
  "Материал синтетический: сгенерирован для тренировки синхронного перевода. " +
  "Цифры и факты в нём выдуманы и не могут служить источником.";
