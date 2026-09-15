// Без пометки server-only: модуль чистый, его гоняют страницы и тесты.
import type { User } from "@/payload-types";

/**
 * Профиль переводчика: что он такое и кто что в нём видит (P1–P3).
 *
 * Главное правило здесь одно: **наружу отдаётся только перечисленное**.
 * Не «всё, кроме скрытого», а «ровно это и ничего больше». Разница
 * существенна: при списке исключений новое поле пользователя — лимит
 * расходов, отметка приглашения, что угодно — уедет коллегам само,
 * и заметить это будет нечем.
 */

/**
 * Языки профиля шире языков генерации.
 *
 * Тренажёр умеет ровно то, на что есть пресеты и голоса Google. Переводчик
 * работает с чем работает, и подрезать его профиль под наши возможности —
 * значит сделать карточку неправдивой.
 */
export const PROFILE_LANGS = [
  { label: "Русский", value: "ru" },
  { label: "English", value: "en" },
  { label: "Deutsch", value: "de" },
  { label: "Français", value: "fr" },
  { label: "Español", value: "es" },
  { label: "Italiano", value: "it" },
  { label: "Português", value: "pt" },
  { label: "Türkçe", value: "tr" },
  { label: "中文", value: "zh" },
  { label: "العربية", value: "ar" },
  { label: "Українська", value: "uk" },
  { label: "Polski", value: "pl" },
];

export const LANG_LABEL: Record<string, string> = Object.fromEntries(
  PROFILE_LANGS.map((l) => [l.value, l.label]),
);

/** Поля, которые владелец скрывает по отдельности (P3). Имя сюда не входит. */
export const VISIBLE_FIELDS = [
  "city",
  "bio",
  "languagePairs",
  "specializations",
  "memberships",
] as const;

export type VisibleField = (typeof VISIBLE_FIELDS)[number];

export interface LanguagePair {
  source: string;
  target: string;
}

/** Профиль глазами смотрящего. Ровно то, что ему положено видеть. */
export interface ProfileView {
  id: number;
  /** Имя видно всегда: карточка без имени — не карточка */
  displayName: string;
  /** Свой ли это профиль — от этого зависит, показывать ли кнопку правки */
  own: boolean;
  city: string | null;
  bio: string | null;
  languagePairs: LanguagePair[];
  specializations: string[];
  memberships: string[];
}

const names = (rows: { name?: string | null }[] | null | undefined): string[] =>
  (rows ?? []).map((row) => row.name?.trim()).filter((name): name is string => Boolean(name));

const pairs = (
  rows: { source?: string | null; target?: string | null }[] | null | undefined,
): LanguagePair[] =>
  (rows ?? [])
    .filter((row) => row.source && row.target)
    .map((row) => ({ source: row.source!, target: row.target! }));

/**
 * Имя для показа.
 *
 * Адрес почты в запасные варианты не годится: коллега не должен узнавать
 * чужую почту просто потому, что человек не заполнил имя.
 */
export const displayNameOf = (user: Pick<User, "displayName">): string =>
  user.displayName?.trim() || "Без имени";

export function profileView(user: User, viewerId: number): ProfileView {
  const own = user.id === viewerId;
  const shown = (field: VisibleField): boolean =>
    own || Boolean((user.visibility as Record<string, unknown> | undefined)?.[field]);

  return {
    id: user.id,
    displayName: displayNameOf(user),
    own,
    city: shown("city") ? (user.city?.trim() || null) : null,
    bio: shown("bio") ? (user.bio?.trim() || null) : null,
    languagePairs: shown("languagePairs") ? pairs(user.languagePairs) : [],
    specializations: shown("specializations") ? names(user.specializations) : [],
    memberships: shown("memberships") ? names(user.memberships) : [],
  };
}

/**
 * Записи, которые смотрящий вправе увидеть в чужом профиле (P4).
 *
 * Правило то же, что у самой записи: владелец видит свои, коллега — те,
 * где он назван, связан и не оспорил. Никакого отдельного «в профиле
 * показываем чуть больше» быть не должно: профиль — витрина тех же записей,
 * а не обходной путь к ним.
 *
 * Счётчики считаются по видимому, а не по всему. Иначе «34 конференции»
 * при двух показанных — это и есть утечка: число говорит то, чего человек
 * показывать не собирался.
 */
export interface ProfileStats {
  visible: number;
  sinceYear: number | null;
}

/** Заполнен ли профиль хоть чем-то — чтобы не показывать коллеге пустую карточку. */
export const profileIsEmpty = (view: ProfileView): boolean =>
  !view.city &&
  !view.bio &&
  view.languagePairs.length === 0 &&
  view.specializations.length === 0 &&
  view.memberships.length === 0;

export const pairLabel = (pair: LanguagePair): string =>
  `${LANG_LABEL[pair.source] ?? pair.source} → ${LANG_LABEL[pair.target] ?? pair.target}`;
