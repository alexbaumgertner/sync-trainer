"use client";

import { useState } from "react";
import { PROFILE_LANGS } from "@/lib/profile";
import { MODES, WENT_LABELS, MEMBER_STATUS_LABELS, type Speaker, type TeamMember } from "@/lib/engagements";

const FIELD =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

export interface EngagementFormValues {
  id?: number;
  title: string;
  organizer: string;
  heldOn: string;
  location: string;
  mode: string;
  sourceLang: string;
  targetLang: string;
  wentHow: number | null;
  wentText: string;
  speakers: Speaker[];
  team: TeamMember[];
  visibility: string;
}

export default function EngagementForm({
  action,
  values,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values: EngagementFormValues;
  submitLabel: string;
}) {
  const [speakers, setSpeakers] = useState<Speaker[]>(values.speakers);
  const [team, setTeam] = useState<TeamMember[]>(values.team);

  const setMember = (index: number, patch: Partial<TeamMember>) =>
    setTeam((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const setSpeaker = (index: number, patch: Partial<Speaker>) =>
    setSpeakers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="grid max-w-2xl gap-6">
      {values.id !== undefined && <input type="hidden" name="id" value={values.id} />}

      <div className="grid gap-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Событие
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={values.title}
          placeholder="Форум по правам женщин"
          className={FIELD}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="organizer" className="text-sm font-medium">
            Организатор
          </label>
          <input
            id="organizer"
            name="organizer"
            defaultValue={values.organizer}
            placeholder="МОТ"
            className={FIELD}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="heldOn" className="text-sm font-medium">
            Дата
          </label>
          <input
            id="heldOn"
            name="heldOn"
            type="date"
            required
            defaultValue={values.heldOn}
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="location" className="text-sm font-medium">
            Место
          </label>
          <input
            id="location"
            name="location"
            defaultValue={values.location}
            placeholder="Женева"
            className={FIELD}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="mode" className="text-sm font-medium">
            Режим
          </label>
          <select id="mode" name="mode" defaultValue={values.mode} className={FIELD}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="sourceLang" className="text-sm font-medium">
            С языка
          </label>
          <select
            id="sourceLang"
            name="sourceLang"
            defaultValue={values.sourceLang}
            className={FIELD}
          >
            {PROFILE_LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="targetLang" className="text-sm font-medium">
            На язык
          </label>
          <select
            id="targetLang"
            name="targetLang"
            defaultValue={values.targetLang}
            className={FIELD}
          >
            {PROFILE_LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Кто переводил</legend>
        <p className="mb-1 text-xs text-neutral-500">
          Имя обязательно, адрес — нет. Если адрес совпадёт с учётной записью
          коллеги, запись свяжется с ним и он сможет её подтвердить. По имени
          не связываем: однофамильцев хватает, а ошибка приписала бы человеку
          чужую работу.
        </p>

        {team.map((member, index) => (
          <div key={index} className="grid gap-2">
            <div className="flex items-center gap-2">
              <input
                name="memberName"
                value={member.name}
                onChange={(e) => setMember(index, { name: e.target.value })}
                placeholder="Имя"
                aria-label={`Имя участника ${index + 1}`}
                className={FIELD}
              />
              <input
                name="memberEmail"
                type="email"
                value={member.email ?? ""}
                onChange={(e) => setMember(index, { email: e.target.value })}
                placeholder="почта, необязательно"
                aria-label={`Почта участника ${index + 1}`}
                className={FIELD}
              />
              <input
                name="memberBooth"
                value={member.booth ?? ""}
                onChange={(e) => setMember(index, { booth: e.target.value })}
                placeholder="кабина"
                aria-label={`Кабина участника ${index + 1}`}
                className={FIELD}
              />
              <button
                type="button"
                onClick={() => setTeam((rows) => rows.filter((_, i) => i !== index))}
                aria-label={`Убрать участника ${index + 1}`}
                className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
              >
                Убрать
              </button>
            </div>
            {member.name && (
              <p className="text-xs text-neutral-500">
                {member.userId ? "связан с учётной записью" : "не связан"} ·{" "}
                {MEMBER_STATUS_LABELS[member.status] ?? member.status}
              </p>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setTeam((rows) => [
              ...rows,
              { name: "", email: "", userId: null, booth: "", status: "listed", confirmedAt: null },
            ])
          }
          className="justify-self-start rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Добавить участника
        </button>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Кто выступал</legend>
        <p className="mb-1 text-xs text-neutral-500">
          Только имена и организации, текстом. Спикеры не пользователи сервиса,
          и их согласия у нас нет — поэтому список видите вы и команда события,
          и больше никто.
        </p>

        {speakers.map((speaker, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              name="speakerName"
              value={speaker.name}
              onChange={(e) => setSpeaker(index, { name: e.target.value })}
              placeholder="Имя"
              aria-label={`Имя спикера ${index + 1}`}
              className={FIELD}
            />
            <input
              name="speakerOrg"
              value={speaker.organization ?? ""}
              onChange={(e) => setSpeaker(index, { organization: e.target.value })}
              placeholder="Организация"
              aria-label={`Организация спикера ${index + 1}`}
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setSpeakers((rows) => rows.filter((_, i) => i !== index))}
              aria-label={`Убрать спикера ${index + 1}`}
              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
            >
              Убрать
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setSpeakers((rows) => [...rows, { name: "", organization: "" }])}
          className="justify-self-start rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Добавить спикера
        </button>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Как прошло</legend>
        <p id="went-hint" className="mb-1 text-xs text-neutral-500">
          Это не разбор: сюда пишут то, что не стыдно показать команде. Где
          сбились и чего не хватило — в разборе проекта, он остаётся приватным.
        </p>
        {Object.entries(WENT_LABELS)
          .reverse()
          .map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="wentHow"
                value={value}
                aria-describedby="went-hint"
                defaultChecked={values.wentHow === Number(value)}
              />
              {label}
            </label>
          ))}
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="wentText" className="text-sm font-medium">
          Подробнее
        </label>
        <textarea
          id="wentText"
          name="wentText"
          rows={4}
          defaultValue={values.wentText}
          placeholder="Регламент сдвинули на час, третья панель шла без перерыва."
          className={FIELD}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="visibility" className="text-sm font-medium">
          Кто видит запись
        </label>
        <select
          id="visibility"
          name="visibility"
          defaultValue={values.visibility}
          className={FIELD}
        >
          <option value="team">Я и команда события</option>
          <option value="private">Только я</option>
        </select>
      </div>

      <button
        type="submit"
        className="justify-self-start rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {submitLabel}
      </button>
    </form>
  );
}
