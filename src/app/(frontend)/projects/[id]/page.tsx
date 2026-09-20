import ArtifactRating from "@/components/artifact-rating";
import AudioPlayer from "@/components/audio-player";
import { saveRating } from "./rate-actions";
import { RATING_TARGETS, ratingFor, type RatingTarget } from "@/lib/ratings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  getProject,
  SOURCE_LANG_LABELS,
  STATUS_LABELS,
  STYLE_PRESET_LABELS,
} from "@/lib/projects";
import {
  addParticipant,
  addTeamMember,
  deleteDocumentSource,
  deleteProject,
  removeParticipant,
  removeTeamMember,
  saveParticipant,
} from "../actions";
import AppShell from "@/components/app-shell";
import DangerousDelete from "@/components/dangerous-delete";
import DocumentUpload from "@/components/document-upload";
import GlossaryBuild from "@/components/glossary-build";
import ParticipantsImport from "@/components/participants-import";
import ScriptBuild from "@/components/script-build";
import GlossaryEditor from "@/components/glossary-editor";
import { payloadClient } from "@/lib/payload";
import { toTermRow } from "@/lib/glossary";
import {
  addTerm,
  addVariant,
  confirmTerm,
  deleteTerm,
  pinToPersonal,
  promoteVariant,
  removeVariant,
  saveTerm,
} from "./glossary/actions";

export const dynamic = "force-dynamic";

const formatBytes = (bytes: number | null): string =>
  bytes === null ? "—" : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(2)} МБ`;

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  /**
   * Раскрыт ли редактор глоссария.
   *
   * `<details>` — состояние разметки, и переход его сбрасывает: после
   * каждой правки список захлопывался, и место приходилось искать заново.
   * Поэтому действия глоссария возвращают сюда с этим параметром.
   */
  const glossaryOpen = (await searchParams).glossary === "open";
  const detail = await getProject(Number(id), user.id);
  if (!detail) notFound();

  const {
    project,
    files,
    documents,
    ratings,
    costUsd,
    glossaryCount,
    hasDebrief,
    team,
    participants,
    isOwner,
  } = detail;

  /**
   * SSML в списке не показывается: это промежуточный формат между скриптом
   * и синтезом, а не результат, к которому возвращаются. Скачать его
   * по-прежнему можно — маршрут файлов его отдаёт, — но место в списке
   * он занимал наравне со скриптом и звуком и сбивал с толку.
   */
  const shownFiles = files.filter((file) => file.kind !== "ssml");

  /**
   * Термины читаем здесь же: глоссарий теперь правится прямо на карточке
   * проекта (I2), а не только на своей странице. Та осталась запасным
   * путём — с неё удобнее работать, когда терминов много.
   */
  const payload = await payloadClient();
  const terms = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: project.id } },
    sort: "sourceTerm",
    limit: 500,
    // Глубина 1: нужны имена тех, кто предложил вариант и кто подтвердил.
    depth: 1,
    overrideAccess: true,
  });
  const termRows = terms.docs.map(toTermRow);

  return (
    <AppShell email={user.email} title={project.title}>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span className="rounded bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
          {STATUS_LABELS[project.status] ?? project.status}
        </span>
        <span>{SOURCE_LANG_LABELS[project.sourceLang] ?? project.sourceLang}</span>
        <span>·</span>
        <span>{STYLE_PRESET_LABELS[project.stylePreset] ?? project.stylePreset}</span>
        <span>·</span>
        <span className="tabular-nums">${costUsd.toFixed(2)}</span>
      </div>

      <dl className="mb-8 grid gap-4 border-y border-neutral-200 py-4 text-sm sm:grid-cols-3 dark:border-neutral-800">
        <Detail label="Событие" value={project.eventName ?? "—"} />
        <Detail label="Дата" value={formatDate(project.eventStartsOn ?? null)} />
        <Detail label="Место" value={project.eventLocation ?? "—"} />
      </dl>

      {/*
        Состав кабины (L1). Стоит выше материалов: кто идёт на событие —
        первое, что определяется, и от этого зависит, кто будет выверять
        глоссарий вместе с вами (K1).
      */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Состав кабины</h2>
        {team.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Пока никого. Названный здесь коллега с учётной записью сможет открыть
            проект и править глоссарий вместе с вами.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {team.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="font-medium">{member.name}</span>
                {member.booth && <span className="text-xs text-neutral-500">{member.booth}</span>}
                <span className="text-xs text-neutral-500">
                  {member.linked ? "правит глоссарий" : "назван, без учётной записи"}
                </span>
                {isOwner && (
                  <form action={removeTeamMember} className="ml-auto">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="memberId" value={member.id} />
                    <button
                      type="submit"
                      className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                    >
                      убрать
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <form action={addTeamMember} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <label className="block text-xs">
              <span className="mb-1 block text-neutral-500">Имя</span>
              <input
                name="name"
                required
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-neutral-500">Почта — по ней даётся доступ</span>
              <input
                name="email"
                type="email"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-neutral-500">Кабина или роль</span>
              <input
                name="booth"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Добавить
            </button>
          </form>
        )}
      </section>

      {/*
        Участники события (L2–L3). Произношение стоит прямо в строке, а не
        прячется в раскрывающейся карточке: перед событием по этому списку
        пробегают глазами, а в кабине читают на ходу.
      */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Кого переводим</h2>
          {participants.some((person) => person.unknown) && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              произношение не выяснено: {participants.filter((p) => p.unknown).length}
            </span>
          )}
        </div>

        {participants.length === 0 ? (
          <p className="mb-3 max-w-prose text-sm text-neutral-500">
            Пока пусто. Имя, которое придётся произнести вслух, лучше выяснить
            заранее — в кабине угадывать некогда.
          </p>
        ) : (
          <ul className="mb-3 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {participants.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{person.name}</span>
                {person.organization && (
                  <span className="text-xs text-neutral-500">{person.organization}</span>
                )}
                {person.note && <span className="text-xs text-neutral-500">{person.note}</span>}

                {isOwner ? (
                  <form action={saveParticipant} className="ml-auto flex items-center gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="personId" value={person.id} />
                    <input
                      name="pronunciation"
                      defaultValue={person.pronunciation ?? ""}
                      placeholder={person.unknown ? "произношение не выяснено" : "произношение"}
                      aria-label={`Произношение: ${person.name}`}
                      className={`w-56 rounded-md border bg-transparent px-2 py-1 text-sm ${
                        person.unknown
                          ? "border-amber-400 dark:border-amber-700"
                          : "border-neutral-300 dark:border-neutral-700"
                      }`}
                    />
                    <button
                      type="submit"
                      className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                    >
                      сохранить
                    </button>
                  </form>
                ) : (
                  <span className="ml-auto text-sm">
                    {person.pronunciation ?? (
                      <span className="text-amber-700 dark:text-amber-400">
                        произношение не выяснено
                      </span>
                    )}
                  </span>
                )}

                {isOwner && (
                  <form action={removeParticipant}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="personId" value={person.id} />
                    <button
                      type="submit"
                      className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                    >
                      убрать
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {isOwner && (
          <div className="flex flex-col gap-3">
            <ParticipantsImport
              projectId={project.id}
              clientUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
            />

            <form action={addParticipant} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <label className="block text-xs">
                <span className="mb-1 block text-neutral-500">Имя</span>
                <input
                  name="name"
                  required
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-neutral-500">Организация</span>
                <input
                  name="organization"
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-neutral-500">Произношение</span>
                <input
                  name="pronunciation"
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Добавить
              </button>
            </form>

            <p className="max-w-prose text-xs text-neutral-500">
              Участники — третьи лица, и согласия на хранение их данных у нас нет:
              здесь только текст, никакой публичной страницы, и всё это исчезнет
              вместе с проектом.
            </p>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Исходные документы</h2>
        {documents.length > 0 && (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="font-medium">{doc.filename}</span>
                <span className="text-xs text-neutral-500">{formatBytes(doc.bytes)}</span>
                {doc.pages && <span className="text-xs text-neutral-500">{doc.pages} с.</span>}
                {doc.hasSource ? (
                  <>
                    <span className="ml-auto text-xs text-neutral-500">оригинал хранится</span>
                    <form action={deleteDocumentSource} className={isOwner ? "" : "hidden"}>
                      <input type="hidden" name="documentId" value={doc.id} />
                      <input type="hidden" name="projectId" value={project.id} />
                      <DangerousDelete
                        label="Удалить оригинал"
                        confirmation={`Удалить оригинал «${doc.filename}»? Запись о документе останется, но собрать по нему заново будет нечего — файл придётся загрузить снова.`}
                      />
                    </form>
                  </>
                ) : (
                  <span className="ml-auto text-xs text-neutral-500">
                    {doc.purgedAt ? "оригинал удалён" : "оригинала нет"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <div className={documents.length > 0 ? "mt-4" : ""}>
            <DocumentUpload
              projectId={project.id}
              clientUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
            />
          </div>
        ) : (
          documents.length === 0 && (
            <p className="text-sm text-neutral-500">
              Материалы загружает тот, кто завёл проект.
            </p>
          )
        )}
      </section>


      {/*
        Глоссарий стоит сразу под материалами и выше файлов со звуком (I1).
        Порядок на странице — это и есть порядок работы: переводчик начинает
        с материалов и глоссария, а скрипт и звук растут уже из него. Пока
        глоссарий висел последним, он читался как побочный продукт.
      */}
      <section id="glossary" className="mb-8 scroll-mt-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Глоссарий</h2>
          {glossaryCount > 0 && (
            <span className="text-xs text-neutral-500">{glossaryCount} терминов</span>
          )}
        </div>

        <p className="mb-4 max-w-prose text-sm text-neutral-500">
          С него начинается подготовка. Термины, предложенные моделью, помечены —
          в кабине они выглядят так же уверенно, как выверенные, а верить им
          нельзя. Правка эквивалента снимает пометку: перевод, написанный вашей
          рукой, подтверждения не требует.
        </p>

        {isOwner ? (
          <GlossaryBuild
            projectId={project.id}
            hasDocuments={documents.some((doc) => doc.hasSource)}
            termCount={glossaryCount}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            Сборку запускает тот, кто завёл проект: она идёт с его счёта. Править
            термины можно и вам.
          </p>
        )}

        {glossaryCount > 0 && (
          <>
            <details
              open={glossaryOpen}
              className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Открыть и править
              </summary>
              <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
                <GlossaryEditor
                  projectId={project.id}
                  viewerId={user.id as number}
                  terms={termRows}
                  returnTo={`/projects/${project.id}`}
                  actions={{
                    saveTerm,
                    confirmTerm,
                    deleteTerm,
                    addTerm,
                    addVariant,
                    removeVariant,
                    promoteVariant,
                    pinToPersonal,
                  }}
                />
              </div>
            </details>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={`/api/projects/${project.id}/glossary?format=xlsx`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Для InterpretBank (XLSX)
              </a>
              <a
                href={`/api/projects/${project.id}/glossary?format=csv`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                CSV
              </a>
              <a
                href={`/projects/${project.id}/glossary/print`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Лист для кабины
              </a>
              <Link
                href={`/projects/${project.id}/glossary`}
                className="text-xs text-neutral-500 underline-offset-2 hover:underline"
              >
                Отдельной страницей
              </Link>
            </div>

            <p className="mt-3 max-w-prose text-xs text-neutral-500">
              При импорте в InterpretBank отметьте <b>Exclude first row</b> — в первой строке
              названия языков, по ним он определяет колонки. Термины, предложенные моделью и
              никем не проверенные, помечены в колонке примечаний. Запасные эквиваленты едут
              туда же, первыми — читают в кабине по диагонали.
            </p>
          </>
        )}
      </section>

      {/*
        Скрипт стоит после глоссария, а не до: он из него и растёт (N3).
        Кнопка не работает, пока терминов нет, и говорит об этом прямо —
        порядок работы должен читаться со страницы, а не из документации.
      */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Тренировочный скрипт</h2>
        <p className="mb-4 max-w-prose text-sm text-neutral-500">
          Речь пишется вокруг ваших терминов: выверенные эквиваленты уходят в
          задание модели, и переписывать их она не станет. Новые термины,
          встреченные по дороге, добавятся в глоссарий как предложенные.
        </p>

        {isOwner ? (
          <ScriptBuild
            projectId={project.id}
            hasDocuments={documents.some((doc) => doc.hasSource)}
            termCount={glossaryCount}
            hasScript={shownFiles.some((file) => file.kind === "script")}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            Скрипт генерирует тот, кто завёл проект.
          </p>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Файлы проекта</h2>
          <Link
            href={`/projects/${project.id}/script`}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700"
          >
            Скрипт и озвучка
          </Link>
        </div>
        {shownFiles.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Здесь появятся скрипт, аудио и выгрузка глоссария — всё, к чему можно
            вернуться перед следующим прогоном. Скрипт сгенерируется кнопкой выше,
            звук — на странице скрипта.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {shownFiles.map((file) => (
              <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{file.label}</span>
                <span className="text-xs text-neutral-500">{formatBytes(file.bytes)}</span>
                <span className="text-xs text-neutral-500">{formatDate(file.createdAt)}</span>
                <a
                  href={`/api/projects/${project.id}/files/${file.id}`}
                  className="ml-auto text-xs underline-offset-2 hover:underline"
                >
                  Скачать
                </a>
                {file.kind === "audio" && (
                  <div className="mt-2 w-full">
                    <AudioPlayer
                      src={`/api/projects/${project.id}/files/${file.id}`}
                      peaksUrl={`/api/projects/${project.id}/files/${file.id}/peaks`}
                      cuesUrl={`/api/projects/${project.id}/files/${file.id}/cues`}
                      title={project.title}
                    />
                  </div>
                )}
                {RATING_TARGETS.includes(file.kind as RatingTarget) && (
                  <div className="mt-1 w-full">
                    <ArtifactRating
                      action={saveRating}
                      projectId={project.id}
                      target={file.kind as RatingTarget}
                      generationId={file.generationId}
                      current={ratingFor(ratings, file.kind as RatingTarget, file.generationId)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">После события</h2>
        <p className="mb-3 max-w-prose text-sm text-neutral-500">
          {hasDebrief
            ? "Разбор сохранён. Его можно дополнить — он пойдёт в подготовку к следующему событию."
            : "Когда событие пройдёт, отметьте, что прозвучало, и запишите, чего не хватило. Это заготовка для следующей подготовки, а не отчёт."}
        </p>
        <Link
          href={`/projects/${project.id}/debrief`}
          className="inline-block rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {hasDebrief ? "Открыть разбор" : "Заполнить разбор"}
        </Link>
      </section>

      <div className="flex items-center justify-between border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <Link href="/projects" className="text-sm text-neutral-500 underline-offset-2 hover:underline">
          ← Ко всем проектам
        </Link>
        <form action={deleteProject} className={isOwner ? "" : "hidden"}>
          <input type="hidden" name="id" value={project.id} />
          <DangerousDelete
            label="Удалить проект"
            confirmation={`Удалить «${project.title}»? Вместе с проектом исчезнут его файлы, глоссарий и разбор. Это необратимо.`}
          />
        </form>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
