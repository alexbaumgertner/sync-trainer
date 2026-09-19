"use client";

import { useState } from "react";
import { authorLabel, STATUS_LABELS, type TermRow } from "@/lib/glossary";

type Action = (formData: FormData) => Promise<void>;

const FIELD =
  "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700";
const QUIET =
  "text-xs text-neutral-500 underline-offset-2 hover:underline disabled:opacity-40";

/**
 * Список терминов с правкой по месту.
 *
 * Строка раскрывается нажатием, а не висит формой: терминов бывает под сотню,
 * и сотня открытых форм — это не редактор, а стена полей. В свёрнутом виде
 * видно то, ради чего сюда заходят: термин, эквивалент, откуда он взялся
 * и есть ли запасные.
 */
export default function GlossaryEditor({
  projectId,
  viewerId,
  terms,
  returnTo,
  actions,
}: {
  projectId: number;
  viewerId: number;
  terms: TermRow[];
  /**
   * Куда вернуть человека после правки (I2).
   *
   * Редактор живёт в двух местах: на карточке проекта и на своей странице.
   * Без этого поля правка с карточки уносила бы на страницу глоссария —
   * то есть со страницы, где человек работает, на другую.
   */
  returnTo?: string;
  actions: {
    saveTerm: Action;
    confirmTerm: Action;
    deleteTerm: Action;
    addTerm: Action;
    addVariant: Action;
    removeVariant: Action;
    promoteVariant: Action;
  };
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const hidden = (termId?: number) => (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {termId !== undefined && <input type="hidden" name="termId" value={termId} />}
    </>
  );

  return (
    <div className="grid gap-3">
      {terms.length === 0 && (
        <p className="text-sm text-neutral-500">
          Глоссарий пуст. Соберите его по материалам события — или заведите термин руками.
        </p>
      )}

      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {terms.map((term) => {
          const open = openId === term.id;
          return (
            <li key={term.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-medium">{term.source}</span>
                <span className="text-neutral-500">—</span>
                <span>{term.target ?? <span className="text-neutral-400">нет эквивалента</span>}</span>

                {term.status === "suggested" && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                    {STATUS_LABELS.suggested}
                  </span>
                )}
                {term.status === "from-practice" && (
                  <span className="text-[11px] text-neutral-500">{STATUS_LABELS["from-practice"]}</span>
                )}
                {term.occurredAtEvent && (
                  <span className="text-[11px] text-neutral-500">прозвучал на событии</span>
                )}

                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : term.id)}
                  aria-expanded={open}
                  className={`ml-auto ${QUIET}`}
                >
                  {open ? "Свернуть" : "Править"}
                </button>
              </div>

              {term.note && !open && (
                <p className="mt-1 text-xs text-neutral-500">{term.note}</p>
              )}

              {term.variants.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {term.variants.map((variant) => (
                    <li key={variant.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="text-neutral-400">вариант:</span>
                      <span>{variant.text}</span>
                      <span className="text-neutral-500">· {authorLabel(variant, viewerId)}</span>
                      {variant.note && <span className="text-neutral-500">· {variant.note}</span>}
                      <form action={actions.promoteVariant} className="contents">
                        {hidden(term.id)}
                        <input type="hidden" name="variantId" value={variant.id} />
                        <button type="submit" className={QUIET}>
                          сделать основным
                        </button>
                      </form>
                      <form action={actions.removeVariant} className="contents">
                        {hidden(term.id)}
                        <input type="hidden" name="variantId" value={variant.id} />
                        <button type="submit" className={QUIET}>
                          убрать
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {open && (
                <div className="mt-3 grid gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                  <form action={actions.saveTerm} className="grid gap-2 sm:grid-cols-2">
                    {hidden(term.id)}
                    <label className="grid gap-1 text-xs">
                      <span className="text-neutral-500">Термин</span>
                      <input name="source" defaultValue={term.source} required className={FIELD} />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-neutral-500">Эквивалент</span>
                      <input name="target" defaultValue={term.target ?? ""} className={FIELD} />
                    </label>
                    <label className="grid gap-1 text-xs sm:col-span-2">
                      <span className="text-neutral-500">Примечание — контекст, оговорки</span>
                      <input name="note" defaultValue={term.note ?? ""} className={FIELD} />
                    </label>
                    <div className="flex items-center gap-3 sm:col-span-2">
                      <button
                        type="submit"
                        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                      >
                        Сохранить
                      </button>
                      {term.status === "suggested" && (
                        <span className="text-xs text-neutral-500">
                          правка эквивалента снимет пометку
                        </span>
                      )}
                      {term.verifiedByName && (
                        <span className="text-xs text-neutral-500">
                          подтвердил: {term.verifiedByName}
                        </span>
                      )}
                    </div>
                  </form>

                  <div className="flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                    {term.status === "suggested" && (
                      <form action={actions.confirmTerm}>
                        {hidden(term.id)}
                        <button type="submit" className={QUIET}>
                          Перевод модели верен — подтвердить как есть
                        </button>
                      </form>
                    )}
                    <form action={actions.deleteTerm} className="ml-auto">
                      {hidden(term.id)}
                      <button type="submit" className={QUIET}>
                        Удалить термин
                      </button>
                    </form>
                  </div>

                  <form
                    action={actions.addVariant}
                    className="grid gap-2 border-t border-neutral-200 pt-3 sm:grid-cols-2 dark:border-neutral-800"
                  >
                    {hidden(term.id)}
                    <label className="grid gap-1 text-xs">
                      <span className="text-neutral-500">Запасной эквивалент</span>
                      <input name="text" required className={FIELD} placeholder="иной перевод" />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-neutral-500">Когда он уместен</span>
                      <input name="note" className={FIELD} placeholder="в суде, у этого заказчика" />
                    </label>
                    <div className="sm:col-span-2">
                      <button type="submit" className={QUIET}>
                        Добавить вариант
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form
          action={actions.addTerm}
          className="grid gap-2 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2 dark:border-neutral-800"
        >
          {hidden()}
          <label className="grid gap-1 text-xs">
            <span className="text-neutral-500">Термин</span>
            <input name="source" required className={FIELD} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-neutral-500">Эквивалент</span>
            <input name="target" className={FIELD} />
          </label>
          <label className="grid gap-1 text-xs sm:col-span-2">
            <span className="text-neutral-500">Примечание</span>
            <input name="note" className={FIELD} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Добавить
            </button>
            <button type="button" onClick={() => setAdding(false)} className={QUIET}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="justify-self-start rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Добавить термин
        </button>
      )}
    </div>
  );
}
