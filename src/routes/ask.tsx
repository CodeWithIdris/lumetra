import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { datasetContext, runTool } from "@/lib/ask/tools";
import { deleteChat, loadChat, saveChat } from "@/lib/persistence/chats";
import type { Dataset } from "@/lib/data/types";
import { pageMeta } from "@/lib/meta";

export const Route = createFileRoute("/ask")({
  head: () =>
    pageMeta("Ask", "Ask questions about your dataset and get answers backed by computed results."),
  component: Ask,
});

const SUGGESTIONS = [
  "Summarise the main patterns in this dataset.",
  "Which numeric variables are most strongly correlated?",
  "Does the average differ between groups? Test it.",
  "Are there outliers I should check?",
];

function Ask() {
  const { active, activeProject } = useStore();
  const navigate = useNavigate();
  if (!active) {
    return (
      <>
        <PageHeader title="Ask" />
        <EmptyState
          title="No dataset loaded"
          action={
            <Button onClick={() => navigate({ to: "/workspace" })}>Go to Data Workspace</Button>
          }
        >
          Load a CSV file or the synthetic sample, then ask questions about it.
        </EmptyState>
      </>
    );
  }
  const key = activeProject?.id ?? `session-${active.dataset.id}`;
  return <ChatWindow key={key} dataset={active.dataset} projectId={activeProject?.id ?? null} />;
}

function ChatWindow({ dataset, projectId }: { dataset: Dataset; projectId: string | null }) {
  const [initial] = useState<UIMessage[]>(() =>
    projectId && typeof window !== "undefined" ? loadChat(projectId) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const ctx = useMemo(() => datasetContext(dataset), [dataset]);
  const dsRef = useRef(dataset);
  dsRef.current = dataset;

  const { messages, sendMessage, status, stop, addToolOutput, setMessages } = useChat({
    id: projectId ?? `session-${dataset.id}`,
    messages: initial,
    transport: new DefaultChatTransport({ api: "/api/ask", body: { dataset: ctx } }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      // Computations run here, in the browser, on the full local dataset.
      const output = runTool(
        dsRef.current,
        toolCall.toolName,
        (toolCall.input ?? {}) as Record<string, unknown>,
      );
      void addToolOutput({
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        output: output as never,
      });
    },
    onError: (e) => setError(e.message || "The assistant could not answer."),
  });

  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    if (projectId && !busy) saveChat(projectId, messages);
  }, [projectId, messages, busy]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setError(null);
    void sendMessage({ text: t });
  }

  const last = messages.at(-1);
  const waiting =
    busy && (!last || last.role === "user" || !last.parts.some((p) => p.type === "text" && p.text));

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Ask"
        description={`Questions about ${dataset.name}. Calculations run on this device; the AI chooses which to run and explains the results.`}
        actions={
          messages.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                stop();
                setMessages([]);
                if (projectId) deleteChat(projectId);
              }}
            >
              New conversation
            </Button>
          )
        }
      />
      <div className="mb-3 space-y-2">
        {!projectId && (
          <Notice tone="warning">
            Unsaved session — this conversation is lost on reload. Save the dataset as a project to
            keep it.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <Conversation className="panel min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 && (
            <div className="space-y-3 py-6">
              <p className="text-[13px] text-muted-foreground">
                Sent to the AI: column names and types, up to 20 sample rows, your questions and
                computed results. Answers can be wrong — check the tool results under each answer.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => submit(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((part, i) => {
                  if (part.type === "text")
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  if (part.type === "reasoning") {
                    return part.text ? (
                      <p
                        key={i}
                        className="border-l-2 pl-3 text-[12px] italic text-muted-foreground"
                      >
                        {part.text}
                      </p>
                    ) : null;
                  }
                  if (part.type.startsWith("tool-")) {
                    const t = part as Parameters<typeof ToolHeader>[0] & {
                      input?: unknown;
                      output?: unknown;
                      errorText?: string;
                      state: string;
                    };
                    return (
                      <Tool key={i} defaultOpen={false}>
                        <ToolHeader
                          type={t.type as `tool-${string}`}
                          state={t.state as never}
                          title={`Computed: ${t.type.slice(5).replace(/_/g, " ")}`}
                        />
                        <ToolContent>
                          <ToolInput input={t.input} />
                          <ToolOutput
                            output={
                              t.output !== undefined ? (
                                <pre className="num overflow-x-auto p-3 text-[11.5px]">
                                  {JSON.stringify(t.output, null, 2)}
                                </pre>
                              ) : undefined
                            }
                            errorText={t.errorText}
                          />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {waiting && <Shimmer className="text-[13px]">Computing…</Shimmer>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <PromptInput className="mt-3" onSubmit={(msg) => submit(msg.text ?? "")}>
        <PromptInputTextarea
          autoFocus
          placeholder="Ask about your data, e.g. “Is income related to age?”"
        />
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={status} onStop={stop} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
