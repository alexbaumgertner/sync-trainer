"use client";

import { useState } from "react";
import { PROFILE_LANGS, type LanguagePair } from "@/lib/profile";
import { saveProfile } from "@/app/(frontend)/profile/actions";

const FIELD = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

/** Подписи к галочкам видимости: что именно увидит коллега. */
const VISIBILITY_LABELS: Record<string, string> = {
  city: "город",
  bio: "текст о себе",
  languagePairs: "языковые пары",
  specializations: "специализации",
  memberships: "объединения",
};

export default function ProfileForm({
  initial,
}: {
  initial: {
    displayName: string;
    city: string;
    bio: string;
    pairs: LanguagePair[];
    specializations: string;
    memberships: string;
    visibility: Record<string, boolean>;
  };
}) {
  // Пары добавляются и убираются на месте: заставлять человека сохранять
  // страницу ради ещё одной строки — издевательство.
  const [pairs, setPairs] = useState<LanguagePair[]>(
    initial.pairs.length ? initial.pairs : [{ source: "en", target: "ru" }],
  );

  const setPair = (index: number, patch: Partial<LanguagePair>) =>
    setPairs((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form action={saveProfile} className="grid max-w-2xl gap-6">
      <div className="grid gap-1.5">
        <label htmlFor="displayName" className="text-sm font-medium">
          Имя
        </label>
        <p id="name-hint" className="text-xs text-neutral-500">
          Как вас называют коллеги. Видно всегда: карточка без имени бесполезна.
        </p>
        <input
          id="displayName"
          name="displayName"
          defaultValue={initial.displayName}
          aria-describedby="name-hint"
          className={FIELD}
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Языковые пары</legend>
        <p className="mb-1 text-xs text-neutral-500">
          Направление имеет значение: перевод в кабину и retour — разная работа
          и разная ставка, поэтому EN→RU и RU→EN указываются отдельно.
        </p>

        {pairs.map((pair, index) => (
          <div key={index} className="flex items-center gap-2">
            <select
              name="pairSource"
              value={pair.source}
              onChange={(e) => setPair(index, { source: e.target.value })}
              aria-label={`Исходный язык пары ${index + 1}`}
              className={FIELD}
            >
              {PROFILE_LANGS.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <span aria-hidden className="text-neutral-400">
              →
            </span>
            <select
              name="pairTarget"
              value={pair.target}
              onChange={(e) => setPair(index, { target: e.target.value })}
              aria-label={`Язык перевода пары ${index + 1}`}
              className={FIELD}
            >
              {PROFILE_LANGS.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPairs((rows) => rows.filter((_, i) => i !== index))}
              aria-label={`Убрать пару ${index + 1}`}
              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
            >
              Убрать
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setPairs((rows) => [...rows, { source: "en", target: "ru" }])}
          className="justify-self-start rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Добавить пару
        </button>
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="city" className="text-sm font-medium">
          Город
        </label>
        <input id="city" name="city" defaultValue={initial.city} className={FIELD} />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="specializations" className="text-sm font-medium">
          Специализации
        </label>
        <p id="spec-hint" className="text-xs text-neutral-500">
          По одной в строке: права человека, климат, медицина, арбитраж.
        </p>
        <textarea
          id="specializations"
          name="specializations"
          rows={4}
          defaultValue={initial.specializations}
          aria-describedby="spec-hint"
          className={FIELD}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="memberships" className="text-sm font-medium">
          Объединения
        </label>
        <p id="mem-hint" className="text-xs text-neutral-500">
          По одному в строке: AIIC, национальная ассоциация, аккредитации.
        </p>
        <textarea
          id="memberships"
          name="memberships"
          rows={3}
          defaultValue={initial.memberships}
          aria-describedby="mem-hint"
          className={FIELD}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium">
          О себе
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={5}
          defaultValue={initial.bio}
          className={FIELD}
        />
      </div>

      <fieldset className="grid gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <legend className="px-1 text-sm font-medium">Что видят коллеги</legend>
        <p className="mb-1 text-xs text-neutral-500">
          Скрытое видите только вы. По умолчанию скрыто всё: показывать нужно
          выбрать, а не запретить.
        </p>
        {Object.entries(VISIBILITY_LABELS).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={`visible_${field}`}
              defaultChecked={initial.visibility[field] ?? false}
            />
            Показывать {label}
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="justify-self-start rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Сохранить профиль
      </button>
    </form>
  );
}
