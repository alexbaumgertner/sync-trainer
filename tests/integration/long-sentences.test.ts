import { describe, expect, it } from "vitest";
import { splitLongSentences, MAX_SENTENCE_CHARS } from "@/lib/ssml";

/** Google отклоняет весь запрос из-за одного слишком длинного предложения. */
const LONG =
  "Para que la señal de la hormona sea adecuadamente transducida, se necesita una combinación de proteínas: dos de cada uno de los dos tipos de receptores de membrana de tipo serina treonina quinasa específicos y endoglina; cuando se une a la hormona, el receptor de tipo II fosforila proteínas del receptor de tipo I, que a su vez fosforilan un complejo de proteínas Smad, y estos se unen a SMAD4 y migran al núcleo celular.";

const longest = (t: string) =>
  Math.max(...(t.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim().length));

describe("длинные предложения", () => {
  it("режет предложение длиннее лимита и не теряет слов", () => {
    expect(LONG.length).toBeGreaterThan(MAX_SENTENCE_CHARS);
    const out = splitLongSentences(LONG);
    expect(longest(out)).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    expect(out.replace(/[.,;:]/g, "").replace(/\s+/g, " ")).toBe(
      LONG.replace(/[.,;:]/g, "").replace(/\s+/g, " "),
    );
  });

  it("режет по словам, если запятых нет", () => {
    const out = splitLongSentences("palabra ".repeat(200).trim() + ".");
    expect(longest(out)).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
  });

  it("короткий текст не трогает", () => {
    expect(splitLongSentences("Hola. ¿Qué tal?")).toBe("Hola. ¿Qué tal?");
  });
});
