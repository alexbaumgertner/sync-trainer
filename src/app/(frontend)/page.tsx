import Studio from "@/components/studio";
import LoginForm from "@/components/login-form";
import { authConfigured, currentUserId } from "@/lib/auth";

// Страница читает сессионную куку, поэтому рендерится на каждый запрос.
export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = authConfigured();
  const userId = configured ? await currentUserId() : null;

  if (!userId) return <LoginForm configured={configured} />;
  return <Studio />;
}
