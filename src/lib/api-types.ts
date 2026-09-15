/**
 * Типы, общие для сервера и клиента.
 *
 * Раньше здесь жили и типы запроса к студии — она удалена 15 сентября
 * вместе со своим маршрутом синтеза: проекты делают то же самое, но
 * с документом, скриптом и глоссарием, а неиспользуемый маршрут,
 * умеющий тратить деньги на Google, лучше не держать вовсе.
 */

export interface UsageEntry {
  at: string;
  chars: number;
  costUsd: number;
  tier: string;
  voices: string[];
  format: string;
  chunks: number;
  seconds: number;
}

export interface UsageSummary {
  /** расход текущего пользователя */
  totalUsd: number;
  totalChars: number;
  generations: number;
  monthUsd: number;
  monthChars: number;

  /** личный месячный потолок; null — личного лимита нет */
  monthLimitUsd: number | null;

  /**
   * Сколько осталось по общим лимитам сервиса. null — общих лимитов нет.
   * Отдаём остаток, а не суммы: обычному пользователю незачем знать оборот,
   * но кнопку гасить надо, поэтому запас он видеть должен.
   */
  globalRemainingUsd: number | null;

  /** Полная картина по сервису. Заполняется только администратору. */
  global: {
    totalUsd: number;
    monthUsd: number;
    generations: number;
    budgetUsd: number | null;
    monthLimitUsd: number | null;
  } | null;

  entries: UsageEntry[];
}
