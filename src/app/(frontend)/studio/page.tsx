import { redirect } from "next/navigation";
import Studio from "@/components/studio";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Прежняя студия: скрипт вставляется руками. Останется здесь до T07–T08,
 * когда генерация переедет внутрь проекта.
 */
export default async function StudioPage() {
  const user = await currentUser();
  if (!user) redirect("/");
  return <Studio />;
}
