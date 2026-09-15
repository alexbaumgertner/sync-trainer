import type { UsageSummary } from "./api-types";

/**
 * Проверка бюджета. Изоморфная: сервер отказывает по ней перед синтезом,
 * клиент по ней же гасит кнопку. Логика одна, разъехаться не может.
 *
 * Всё нужное лежит в самой сводке: личный лимит и остаток по общим лимитам
 * сервиса. Сводку собирает сервер, поэтому клиент не может её подделать
 * в свою пользу — он лишь рисует то, что решил сервер.
 *
 * Считается по НАШЕЙ оценке стоимости, а не по счёту Google: это защита
 * от очевидного перерасхода, а не бухгалтерия до цента.
 */
export function budgetBlock(summary: UsageSummary, pendingUsd: number): string | null {
  // Копеечные суммы toFixed(2) превращает в "$0.00", и сообщение читается
  // как сломанное — для них показываем больше знаков.
  const money = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

  if (summary.globalRemainingUsd !== null && pendingUsd > summary.globalRemainingUsd) {
    return (
      `Общий лимит сервиса исчерпан: осталось ${money(Math.max(summary.globalRemainingUsd, 0))}, ` +
      `а эта генерация стоит ${money(pendingUsd)}. Обратитесь к владельцу проекта.`
    );
  }

  if (summary.monthLimitUsd !== null && summary.monthUsd + pendingUsd > summary.monthLimitUsd) {
    return (
      `Ваш месячный лимит исчерпан: потрачено ${money(summary.monthUsd)} из ` +
      `${money(summary.monthLimitUsd)}, эта генерация добавила бы ${money(pendingUsd)}. ` +
      `Лимит сбросится первого числа.`
    );
  }

  return null;
}
