import { NextResponse } from "next/server";

import { loadUserContext } from "../../../lib/agent/context";
import { gymBroSystemPrompt, shouldUseTavilySearch } from "../../../lib/agent/gymbro";
import { tavilySearch } from "../../../lib/mcp/tavily";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { supabaseServer } from "../../../lib/supabase/server";
import { openAIChatComplete, type OpenAIChatMessage, type OpenAITool, type OpenAIToolCall } from "../../../lib/tools/openai";

export const dynamic = "force-dynamic";

type StreamEvent =
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "assistant"; content: string }
  | { type: "error"; message: string };

type ChatMessageRow = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
};

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Server error";
}

const tavilyTool: OpenAITool = {
  type: "function",
  function: {
    name: "tavily_search",
    description: "Search the web for latest fitness, nutrition, and research info",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  }
};

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        function send(evt: StreamEvent) {
          controller.enqueue(encoder.encode(`${JSON.stringify(evt)}\n`));
        }

        try {
          const body = (await req.json()) as unknown;
          const bodyObj = (body ?? {}) as Record<string, unknown>;
          const threadIdInput = typeof bodyObj.threadId === "string" ? bodyObj.threadId : null;
          const userText = typeof bodyObj.message === "string" ? bodyObj.message.trim() : "";

          if (!userText) {
            send({ type: "error", message: "Missing message" });
            controller.close();
            return;
          }

          const supabase = await supabaseServer();
          const {
            data: { user }
          } = await supabase.auth.getUser();

          if (!user) {
            send({ type: "error", message: "Unauthorized" });
            controller.close();
            return;
          }

          const admin = supabaseAdmin();

          let threadId = threadIdInput;
          if (threadId) {
            const { data: thread } = await admin
              .from("chat_threads")
              .select("id")
              .eq("id", threadId)
              .eq("user_id", user.id)
              .maybeSingle();
            if (!thread) threadId = null;
          }

          if (!threadId) {
            const id = crypto.randomUUID();
            const createdRes = await admin
              .from("chat_threads")
              .insert({ id, user_id: user.id, title: "Gym Bro" })
              .select("id")
              .single();
            if (createdRes.error) throw new Error(`Failed to create chat thread: ${createdRes.error.message}`);
            const created = createdRes.data;
            if (!created?.id) throw new Error("Failed to create chat thread: no id returned");
            threadId = created.id;
          }

          {
            const id = crypto.randomUUID();
            const ins = await admin.from("chat_messages").insert({
              id,
            thread_id: threadId,
            user_id: user.id,
            role: "user",
            content: userText,
            metadata: {}
          });
            if (ins.error) throw new Error(`Failed to save user message: ${ins.error.message}`);
          }

          const context = await loadUserContext({ supabase: admin, userId: user.id });

          const { data: historyData } = await admin
            .from("chat_messages")
            .select("id, role, content, created_at")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: true })
            .limit(30);

          const system = gymBroSystemPrompt(context);

          const messages: OpenAIChatMessage[] = [
            { role: "system", content: system },
            ...(Array.isArray(historyData)
              ? (historyData as ChatMessageRow[])
                  .filter((m) => m.role === "user" || m.role === "assistant")
                  .map((m) => ({ role: m.role, content: m.content || "" } as OpenAIChatMessage))
              : [])
          ];

          const mustSearch = shouldUseTavilySearch(userText);

          let iterations = 0;
          while (iterations < 4) {
            iterations += 1;

            const toolChoice: "auto" | { type: "function"; function: { name: string } } =
              mustSearch && iterations === 1 ? { type: "function", function: { name: "tavily_search" } } : "auto";
            const choice = await openAIChatComplete({ messages, tools: [tavilyTool], toolChoice });

            if (Array.isArray(choice.tool_calls) && choice.tool_calls.length > 0) {
              for (const tc of choice.tool_calls as OpenAIToolCall[]) {
                const name = tc.function?.name;
                if (name !== "tavily_search") continue;

                let query = userText;
                try {
                  const args = JSON.parse(tc.function.arguments || "{}") as { query?: unknown };
                  if (typeof args.query === "string" && args.query.trim()) query = args.query.trim();
                } catch {}

                send({ type: "tool_start", name: "tavily_search" });
                const result = await tavilySearch(query);
                send({ type: "tool_end", name: "tavily_search" });

                {
                  const id = crypto.randomUUID();
                  const ins = await admin.from("chat_messages").insert({
                    id,
                  thread_id: threadId,
                  user_id: user.id,
                  role: "tool",
                  tool_name: "tavily_search",
                  content: JSON.stringify(result),
                  metadata: { query, resultsCount: result.results.length }
                });
                  if (ins.error) throw new Error(`Failed to save tool message: ${ins.error.message}`);
                }

                messages.push({
                  role: "assistant",
                  content: "",
                  tool_calls: choice.tool_calls
                });
                messages.push({
                  role: "tool",
                  tool_call_id: tc.id || "tavily_search",
                  content: JSON.stringify(result)
                });
              }
              continue;
            }

            const assistantText = typeof choice.content === "string" ? choice.content.trim() : "";
            if (!assistantText) throw new Error("Empty assistant response");

            {
              const id = crypto.randomUUID();
              const ins = await admin.from("chat_messages").insert({
                id,
              thread_id: threadId,
              user_id: user.id,
              role: "assistant",
              content: assistantText,
              metadata: {}
            });
              if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
            }

            send({ type: "assistant", content: assistantText });
            controller.close();
            return;
          }

          throw new Error("Tool loop exceeded");
        } catch (err: unknown) {
          const message = errorMessage(err);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message } satisfies StreamEvent)}\n`));
          controller.close();
        }
      })();
    }
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
