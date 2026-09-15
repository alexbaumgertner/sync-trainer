"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { PROFILE_LANGS } from "@/lib/profile";
import { MODE_LABELS } from "@/lib/engagements";
import type { Engagement } from "@/payload-types";

const LANGS = new Set(PROFILE_LANGS.map((l) => l.value));
const MODES = new Set(Object.keys(MODE_LABELS));

type Speaker = NonNullable<Engagement["speakers"]>[number];

/** Спикеры приходят двумя параллельными списками полей формы (W4). */
const speakersFrom = (names: string[], orgs: string[]): Speaker[] => {
  const out: Speaker[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    const name = names[i]?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, organization: orgs[i]?.trim() || undefined } as Speaker);
  }
  return out;
};

const fields = (formData: FormData) => {
  const text = (key: string): string | undefined => {
    const value = String(formData.get(key) ?? "").trim();
    return value || undefined;
  };

  const lang = (key: string, fallback: string): string => {
    const value = String(formData.get(key) ?? "");
    return LANGS.has(value) ? value : fallback;
  };

  const rawWent = Number(formData.get("wentHow"));
  const wentHow = Number.isInteger(rawWent) && rawWent >= 1 && rawWent <= 5 ? rawWent : null;

  const mode = String(formData.get("mode") ?? "");

  return {
    title: String(formData.get("title") ?? "").trim(),
    organizer: text("organizer"),
    heldOn: text("heldOn"),
    location: text("location"),
    mode: (MODES.has(mode) ? mode : "simultaneous") as Engagement["mode"],
    sourceLang: lang("sourceLang", "en") as Engagement["sourceLang"],
    targetLang: lang("targetLang", "ru") as Engagement["targetLang"],
    wentHow,
    wentText: text("wentText"),
    speakers: speakersFrom(
      formData.getAll("speakerName").map(String),
      formData.getAll("speakerOrg").map(String),
    ),
    visibility: (String(formData.get("visibility")) === "private"
      ? "private"
      : "team") as Engagement["visibility"],
  };
};

/** Создание записи (W1–W5). */
export async function createEngagement(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const data = fields(formData);
  // Название и дата — то, без чего запись не запись: она о конкретном
  // событии в конкретный день, иначе это заметка ни о чём.
  if (!data.title) redirect("/experience/new?error=title");
  if (!data.heldOn) redirect("/experience/new?error=date");

  const payload = await payloadClient();
  const created = await payload.create({
    collection: "engagements",
    data: { ...data, heldOn: data.heldOn!, owner: user.id },
    overrideAccess: true,
  });

  revalidatePath("/experience");
  redirect(`/experience/${created.id}?saved=1`);
}

/** Правка записи. Владение проверяется до записи, а не после. */
export async function updateEngagement(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/experience");

  const payload = await payloadClient();
  const existing = await payload
    .findByID({ collection: "engagements", id, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof existing?.owner === "object" ? existing.owner?.id : existing?.owner;
  if (!existing || ownerId !== user.id) redirect("/experience");

  const data = fields(formData);
  if (!data.title || !data.heldOn) redirect(`/experience/${id}?error=required`);

  await payload.update({
    collection: "engagements",
    id,
    data: { ...data, heldOn: data.heldOn! },
    overrideAccess: true,
  });

  revalidatePath("/experience");
  redirect(`/experience/${id}?saved=1`);
}

/** Удаление записи. */
export async function deleteEngagement(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/experience");

  const payload = await payloadClient();
  const existing = await payload
    .findByID({ collection: "engagements", id, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof existing?.owner === "object" ? existing.owner?.id : existing?.owner;
  if (!existing || ownerId !== user.id) redirect("/experience");

  await payload.delete({ collection: "engagements", id, overrideAccess: true });

  revalidatePath("/experience");
  redirect("/experience");
}
