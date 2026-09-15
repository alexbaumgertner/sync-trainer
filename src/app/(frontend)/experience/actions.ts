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
type Member = NonNullable<Engagement["team"]>[number];

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

/**
 * Команда события (W3).
 *
 * Имя обязательно, адрес — нет. Связь с учётной записью появляется, только
 * если адрес совпал: по имени связывать нельзя, однофамильцев достаточно,
 * а ошибка здесь приписала бы человеку чужую работу.
 *
 * Прежние статусы сохраняются: правка списка не должна сбрасывать чужое
 * подтверждение — оно дано человеком, а не владельцем записи.
 */
async function teamFrom(
  payload: Awaited<ReturnType<typeof payloadClient>>,
  names: string[],
  emails: string[],
  booths: string[],
  previous: Member[],
): Promise<Member[]> {
  const before = new Map(
    previous.map((m) => [(m.email?.trim().toLowerCase() || m.name.trim().toLowerCase()), m]),
  );

  const out: Member[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    const name = names[i]?.trim();
    if (!name) continue;

    const email = emails[i]?.trim().toLowerCase() || undefined;
    const key = email || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let user: number | undefined;
    if (email) {
      const found = await payload.find({
        collection: "users",
        where: { email: { equals: email } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      user = found.docs[0]?.id;
    }

    const old = before.get(key);
    out.push({
      name,
      email,
      user,
      booth: booths[i]?.trim() || undefined,
      // Статус и отметку подтверждения переносим как есть: их ставит коллега,
      // и владелец записи не должен уметь сбросить их правкой формы.
      status: old?.status ?? "listed",
      confirmedAt: old?.confirmedAt ?? undefined,
    } as Member);
  }

  return out;
}

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
    teamNames: formData.getAll("memberName").map(String),
    teamEmails: formData.getAll("memberEmail").map(String),
    teamBooths: formData.getAll("memberBooth").map(String),
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
  const { teamNames, teamEmails, teamBooths, ...rest } = data;
  const team = await teamFrom(payload, teamNames, teamEmails, teamBooths, []);

  const created = await payload.create({
    collection: "engagements",
    data: { ...rest, heldOn: data.heldOn!, owner: user.id, team },
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

  const { teamNames, teamEmails, teamBooths, ...rest } = data;
  const team = await teamFrom(
    payload,
    teamNames,
    teamEmails,
    teamBooths,
    (existing.team ?? []) as Member[],
  );

  await payload.update({
    collection: "engagements",
    id,
    data: { ...rest, heldOn: data.heldOn!, team },
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
