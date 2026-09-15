"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { PROFILE_LANGS, VISIBLE_FIELDS } from "@/lib/profile";
import type { User } from "@/payload-types";

type Pair = NonNullable<User["languagePairs"]>[number];

const LANGS = new Set(PROFILE_LANGS.map((l) => l.value));

/** Строки списка: по одной в строке, пустые и повторы отбрасываются. */
const listFrom = (raw: string): { name: string }[] => {
  const seen = new Set<string>();
  const out: { name: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim().replace(/^[-*•·]\s+/, "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
  }
  return out;
};

/**
 * Пары приходят двумя параллельными списками из повторяющихся полей формы.
 *
 * Пара без обоих концов — не пара: строку, где выбрали только исходный язык,
 * молча выбрасываем, а не сохраняем половину.
 */
const pairsFrom = (sources: string[], targets: string[]): Pair[] => {
  const seen = new Set<string>();
  const out: Pair[] = [];

  for (let i = 0; i < Math.max(sources.length, targets.length); i++) {
    const source = sources[i]?.trim();
    const target = targets[i]?.trim();
    if (!source || !target) continue;
    if (!LANGS.has(source) || !LANGS.has(target)) continue;

    // EN→RU и RU→EN — разные строки, а вот EN→RU дважды не нужно.
    const key = `${source}>${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Значения сверены со списком языков выше, поэтому приведение безопасно.
    out.push({ source, target } as Pair);
  }
  return out;
};

/** Сохранение профиля (P1, P3). */
export async function saveProfile(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const text = (key: string): string | undefined => {
    const value = String(formData.get(key) ?? "").trim();
    return value || undefined;
  };

  const strings = (key: string): string[] =>
    formData.getAll(key).map((v) => String(v));

  // Скрыто по умолчанию: галочка присылается формой, только если поставлена.
  const visibility = Object.fromEntries(
    VISIBLE_FIELDS.map((field) => [field, formData.get(`visible_${field}`) === "on"]),
  );

  const payload = await payloadClient();
  await payload.update({
    collection: "users",
    id: user.id,
    data: {
      displayName: text("displayName"),
      city: text("city"),
      bio: text("bio"),
      languagePairs: pairsFrom(strings("pairSource"), strings("pairTarget")),
      specializations: listFrom(String(formData.get("specializations") ?? "")),
      memberships: listFrom(String(formData.get("memberships") ?? "")),
      visibility,
    },
    overrideAccess: true,
  });

  revalidatePath("/profile");
  redirect("/profile?saved=1");
}
