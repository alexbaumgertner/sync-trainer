"use client";

import { useState } from "react";

export interface StyleFieldsProps {
  languages: { value: string; label: string }[];
  /** Качество встроенных пресетов по языкам: нет языка — пресет недоступен */
  presets: { id: string; label: string; languages: Record<string, "full" | "draft"> }[];
  custom: { id: number; label: string }[];
  inputClass: string;
}

/**
 * Язык речи и стилистика вместе: список стилистик зависит от выбранного
 * языка. Встроенный пресет без этого языка не показывается, а «черновой»
 * считается для выбранного языка, а не для английского.
 */
export default function StyleFields({ languages, presets, custom, inputClass }: StyleFieldsProps) {
  const [lang, setLang] = useState("en");
  const [style, setStyle] = useState("un");

  const available = presets.filter((preset) => preset.languages[lang]);
  const value =
    style.startsWith("custom:") || available.some((preset) => preset.id === style)
      ? style
      : (available[0]?.id ?? "");

  return (
    <>
      <div className="mb-4 text-xs">
        <label htmlFor="sourceLang" className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300">
          Язык речи
        </label>
        <select
          id="sourceLang"
          aria-describedby="sourceLang-hint"
          name="sourceLang"
          value={lang}
          onChange={(event) => setLang(event.target.value)}
          className={inputClass}
        >
          {languages.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <p id="sourceLang-hint" className="mt-1 text-neutral-500">
          На нём будет звучать тренировочное аудио и писаться скрипт
        </p>
      </div>

      <div className="mb-4 text-xs">
        <label htmlFor="stylePreset" className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300">
          Стилистика
        </label>
        <select
          id="stylePreset"
          aria-describedby="stylePreset-hint"
          name="stylePreset"
          value={value}
          onChange={(event) => setStyle(event.target.value)}
          className={inputClass}
        >
          <optgroup label="Встроенные">
            {available.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
                {preset.languages[lang] === "full" ? "" : " — черновой"}
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Мои стилистики">
              {custom.map((item) => (
                <option key={item.id} value={`custom:${item.id}`}>
                  {item.label} — черновой
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p id="stylePreset-hint" className="mt-1 text-neutral-500">
          Определяет регистр, роли спикеров и терминологию. Черновые пресеты не выверены носителем
        </p>
      </div>
    </>
  );
}
