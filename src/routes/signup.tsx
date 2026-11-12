import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/signup")({
  head: () => pageMeta("Create account", "Create a Lumetra account for your analytical work."),
  component: () => <AuthPage mode="signup" />,
});
