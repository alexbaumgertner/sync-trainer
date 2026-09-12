import type { UsageSummary } from "./api-types";

/**
 * Проверка бюджета. Изоморфная: сервер отказывает по ней в /api/tts, клиент
 * по ней же гасит кнопку. Логика одна, разъехаться не может.
 *
 * Лимиты берутся из самой сводки (их туда кладёт сервер из переменных
 * окружения), поэтому функции не нужен доступ к process.env.
 *
 * Считается по НАШЕЙ оценке стоимости, а не по счёту Google: это защита от
 * очевидного перерасхода, а не бухгалтерия до цента.
 */
export function budgetBlock(summary: UsageSummary, pendingUsd: number): string | null {
  // Копеечные суммы toFixed(2) превращает в "$0.00", и сообщение читается
  // как сломанное — для них показываем больше знаков.
  const money = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

  if (summary.monthLimitUsd !== null && summary.monthUsd + pendingUsd > summary.monthLimitUsd) {
    return (
      `Месячный лимит исчерпан: потрачено ${money(summary.monthUsd)} из ` +
      `${money(summary.monthLimitUsd)}, эта генерация добавила бы ${money(pendingUsd)}. ` +
      `Лимит сбросится первого числа или поднимите TTS_MONTHLY_LIMIT_USD.`
    );
  }

  if (summary.budgetUsd !== null && summary.totalUsd + pendingUsd > summary.budgetUsd) {
    return (
      `Общий лимит исчерпан: потрачено ${money(summary.totalUsd)} из ` +
      `${money(summary.budgetUsd)}, эта генерация добавила бы ${money(pendingUsd)}. ` +
      `Поднимите TTS_BUDGET_USD, если это осознанно.`
    );
  }

  return null;
}
