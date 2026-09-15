import type { Metadata } from "next";
import { redirect } from "next/navigation";
import config from "@payload-config";
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { importMap } from "../importMap.js";
import { currentUserId } from "@/lib/auth";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams });

/**
 * Вход в админку — тот же, что и в приложение: код на почту.
 *
 * Паролей нет, поэтому собственная форма входа Payload здесь показала бы
 * поле, в которое нечего вводить. Неавторизованного отправляем на наш вход;
 * после него сессионная кука откроет и админку — стратегия одна на оба.
 */
const Page = async ({ params, searchParams }: Args) => {
  if (!(await currentUserId())) redirect("/");
  return RootPage({ config, params, searchParams, importMap });
};

export default Page;
