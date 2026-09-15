import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Кириллица в подмножествах — не косметика, а предзагрузка.
 *
 * Начертания для неё у Geist есть и без этой строки: Next объявляет
 * `@font-face` на все подмножества семейства, и браузер дотягивает нужное,
 * встретив первую русскую букву. Интерфейс у нас русский целиком — то есть
 * лениво тянулось ровно то начертание, которым набрано почти всё, и до его
 * приезда текст рисовался запасным шрифтом.
 *
 * Список `subsets` управляет не наличием, а предзагрузкой. Указав кириллицу,
 * мы переносим её файл в те, что уходят вместе со страницей.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

// Моноширинный набирает код из письма, редактор скрипта и разбор — везде
// латиница и цифры, кириллице там взяться неоткуда.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Тренажёр синхрониста · генератор аудио",
  description: "SSML-скрипт → озвучка через Google Cloud Text-to-Speech",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/*
          Счётчик страниц (слой 1 метрик). Кук не ставит и человека не
          опознаёт — считает по отпечатку запроса, поэтому баннер согласия
          не нужен. Показывает, куда заходят; чего в нём принципиально нет,
          так это пути конкретного человека — для этого коллекция `activity`.

          В адресах у нас только идентификаторы. Если когда-нибудь в путь
          или заголовок страницы попадёт название мероприятия, оно уедет
          сюда и останется навсегда, а согласия на это переводчик не давал.
        */}
        <Analytics />
      </body>
    </html>
  );
}
