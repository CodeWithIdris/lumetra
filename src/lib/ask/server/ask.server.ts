import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import { TOOL_SPECS } from "../tools";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server";

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const INSTRUCTIONS = `You are Lumetra's analysis assistant. You help analysts answer questions about ONE dataset that lives in the user's browser.

Rules — these are strict:
- Every number you state MUST come from a tool result in this conversation. Never estimate, recall or invent statistics. If you need a number, call a tool.
- Prefer computing over guessing; call several tools if needed (e.g. describe, then compare_groups).
- Report sample sizes (n), missing-data exclusions, the method/test used and p-values where relevant.
- Never claim causation from observational data. Say "associated with", not "causes".
- If a question cannot be answered with the available tools or columns, say so plainly and suggest what would be needed.
- If a tool returns an error, explain it or retry with corrected arguments.
- Be concise. Use short paragraphs, bullet points and small markdown tables. Round sensibly (3 significant figures) but don't change values.`;

export interface AskBody {
  messages: UIMessage[];
  dataset: unknown;
}

function isBody(x: unknown): x is AskBody {
  const b = x as AskBody;
  return (
    !!b &&
    Array.isArray(b.messages) &&
    b.messages.length > 0 &&
    b.messages.length <= 200 &&
    typeof b.dataset === "object" &&
    b.dataset !== null
  );
}

export async function handleAsk(request: Request): Promise<Response> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey)
    return Response.json({ error: "AI is not configured for this app." }, { status: 500 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isBody(body)) return Response.json({ error: "Invalid request." }, { status: 400 });
  const ctx = JSON.stringify(body.dataset);
  if (ctx.length > 60_000)
    return Response.json({ error: "Dataset context is too large." }, { status: 413 });

  const tools = Object.fromEntries(
    Object.entries(TOOL_SPECS).map(([name, spec]) => [
      name,
      // No execute: tools run in the browser against the local dataset.
      tool({
        description: spec.description,
        inputSchema: jsonSchema(spec.schema as Parameters<typeof jsonSchema>[0]),
      }),
    ]),
  ) as unknown as ToolSet;

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    instructions: `${INSTRUCTIONS}\n\nDataset context (schema and up to 20 sample rows; the full dataset is only reachable via tools):\n${ctx}`,
    messages: await convertToModelMessages(body.messages),
    tools,
    maxRetries: 1,
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  return withLovableAiGatewayRunIdHeader(
    result.toUIMessageStreamResponse({
      originalMessages: body.messages,
      sendReasoning: true,
      onError: (e) => {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 402)
          return "AI credits are used up. Add credits to your workspace to keep asking questions.";
        if (status === 429)
          return "Too many requests right now. Please wait a moment and try again.";
        if (status === 403) return "AI access is blocked for this workspace.";
        console.error("ask error", e);
        return "The assistant could not answer. Please try again.";
      },
    }),
    runIdFetch,
  );
}
