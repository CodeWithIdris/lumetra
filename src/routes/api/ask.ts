import { createFileRoute } from "@tanstack/react-router";
import { handleAsk } from "@/lib/ask/server/ask.server";

export const Route = createFileRoute("/api/ask")({
  server: { handlers: { POST: ({ request }) => handleAsk(request) } },
});
