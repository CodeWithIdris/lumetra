import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/login")({
  head: () => pageMeta("Sign in", "Sign in to continue to your Lumetra workspace."),
  component: () => <AuthPage mode="login" />,
});
