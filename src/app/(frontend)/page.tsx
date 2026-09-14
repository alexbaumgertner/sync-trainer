import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { authConfigured, currentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = authConfigured();
  const userId = configured ? await currentUserId() : null;

  if (userId) redirect("/projects");
  return <LoginForm configured={configured} />;
}
