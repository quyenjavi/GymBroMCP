import { NextResponse } from "next/server";

import { loadUserContext } from "../../../lib/agent/context";
import { gymBroSystemPrompt, shouldUseTavilySearch } from "../../../lib/agent/gymbro";
import { tavilySearch } from "../../../lib/mcp/tavily";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { supabaseServer } from "../../../lib/supabase/server";
import {
  openAIChatComplete,
  type OpenAIChatMessage,
  type OpenAITool,
  type OpenAIToolCall
} from "../../../lib/tools/openai";

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

type ProfilePatch = {
  display_name?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  age?: number | null;
  gender?: string | null;
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

function isGreeting(text: string) {
  const normalized = text.trim().toLowerCase();
  return ["hi", "hello", "hey", "yo", "sup"].includes(normalized);
}

function isProfileLoopAssistantMessage(content: string) {
  const normalized = content.trim().toLowerCase();
  return (
    normalized.startsWith("got it! here’s your profile") ||
    normalized.startsWith("got it! here's your profile") ||
    normalized.startsWith("got it! your info is set") ||
    normalized.startsWith("got it! your profile is updated") ||
    normalized.includes("this info will help tailor") ||
    normalized.includes("ready to keep pushing") ||
    normalized.includes("your info has been updated")
  );
}

function parseProfilePatch(userText: string): { patch: ProfilePatch; reset: boolean } | null {
  const text = userText.trim();
  const lower = text.toLowerCase();

  if (lower.includes("reset my info") || lower.includes("clear my info")) {
    return {
      reset: true,
      patch: {
        display_name: null,
        weight_kg: null,
        height_cm: null,
        age: null,
        gender: null
      }
    };
  }

  const patch: ProfilePatch = {};

  const nameMatch =
    text.match(/my name is\s+([a-zA-Z][a-zA-Z0-9 _-]{0,40})/i) ||
    text.match(/call me\s+([a-zA-Z][a-zA-Z0-9 _-]{0,40})/i);
  if (nameMatch?.[1]) patch.display_name = nameMatch[1].trim();

  const weightMatch = text.match(/(\d{2,3}(?:\.\d+)?)\s*kg\b/i);
  if (weightMatch?.[1]) patch.weight_kg = Number(weightMatch[1]);

  const heightMatch = text.match(/(\d{3}(?:\.\d+)?)\s*cm\b/i);
  if (heightMatch?.[1]) patch.height_cm = Number(heightMatch[1]);

  const ageMatch = text.match(/(\d{1,3})\s*(?:years old|year old|yo)\b/i);
  if (ageMatch?.[1]) patch.age = Number(ageMatch[1]);

  if (/\bmale\b/i.test(text)) patch.gender = "male";
  if (/\bfemale\b/i.test(text)) patch.gender = "female";

  if (Object.keys(patch).length === 0) return null;
  return { patch, reset: false };
}

async function applyProfilePatch(
  admin: ReturnType<typeof supabaseAdmin>,
  userId: string,
  patch: ProfilePatch
) {
  const payload: Record<string, string | number | null> = {};

  if ("display_name" in patch) payload.display_name = patch.display_name ?? null;
  if ("weight_kg" in patch) payload.weight_kg = patch.weight_kg ?? null;
  if ("height_cm" in patch) payload.height_cm = patch.height_cm ?? null;
  if ("age" in patch) payload.age = patch.age ?? null;
  if ("gender" in patch) payload.gender = patch.gender ?? null;

  const { error } = await admin
    .from("user_profiles")
    .upsert(
      {
        id: userId,
        ...payload
      },
      { onConflict: "id" }
    );

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }
}

function profileConfirmationText(patch: ProfilePatch, reset: boolean) {
  if (reset) {
    return "Your profile info has been reset. You can tell me your name, weight, height, age, or goal anytime.";
  }

  const parts: string[] = [];
  if (patch.display_name) parts.push(`Name: ${patch.display_name}`);
  if (typeof patch.weight_kg === "number") parts.push(`Weight: ${patch.weight_kg}kg`);
  if (typeof patch.height_cm === "number") parts.push(`Height: ${patch.height_cm}cm`);
  if (typeof patch.age === "number") parts.push(`Age: ${patch.age}`);
  if (patch.gender) parts.push(`Gender: ${patch.gender}`);

  if (parts.length === 0) {
    return "Got it. Your profile has been updated.";
  }

  return `Got it. I updated your profile.\n- ${parts.join("\n- ")}`;
}

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

            if (createdRes.error) {
              throw new Error(`Failed to create chat thread: ${createdRes.error.message}`);
            }
            if (!createdRes.data?.id) {
              throw new Error("Failed to create chat thread: no id returned");
            }
            threadId = createdRes.data.id;
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

          // deterministic profile handling
          const profileIntent = parseProfilePatch(userText);
          if (profileIntent) {
            await applyProfilePatch(admin, user.id, profileIntent.patch);

            const assistantText = profileConfirmationText(
              profileIntent.patch,
              profileIntent.reset
            );

            const id = crypto.randomUUID();
            const ins = await admin.from("chat_messages").insert({
              id,
              thread_id: threadId,
              user_id: user.id,
              role: "assistant",
              content: assistantText,
              metadata: { kind: "profile_update" }
            });
            if (ins.error) {
              throw new Error(`Failed to save assistant message: ${ins.error.message}`);
            }

            send({ type: "assistant", content: assistantText });
            controller.close();
            return;
          }

          const context = await loadUserContext({ supabase: admin, userId: user.id });

          const { data: historyData } = await admin
            .from("chat_messages")
            .select("role, content")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: true })
            .limit(20);

          const filteredHistory =
            (historyData as ChatMessageRow[] | null | undefined)?.filter((m) => {
              if (!m.content) return false;
              if (m.role !== "user" && m.role !== "assistant") return false;
              if (m.role === "assistant" && isProfileLoopAssistantMessage(m.content)) return false;
              return true;
            }) ?? [];

          const baseSystemPrompt = gymBroSystemPrompt(context);

          const hardRules = `
You are inside a private fitness coaching app.

You ARE allowed to use the user's fitness profile and workout history inside this app.
This includes name, weight, height, age, gender, and workout logs.

GLOBAL RULES:
1. Never refuse normal fitness/profile requests.
2. Never say "I can't store personal info".
3. Never repeat stored profile info unless the user explicitly asks for it.
4. If the user greets you, reply naturally in 1 short sentence.
5. If workout history exists in context, use it.
6. If workout history does not exist, say that clearly and briefly.
7. Act like a coach, not a policy bot.
`;

          const messages: OpenAIChatMessage[] = [
            { role: "system", content: baseSystemPrompt },
            { role: "system", content: hardRules },
            ...filteredHistory.map(
              (m) =>
                ({
                  role: m.role,
                  content: m.content || ""
                }) as OpenAIChatMessage
            )
          ];

          if (isGreeting(userText)) {
            messages.push({
              role: "system",
              content:
                "The user is greeting you. Reply naturally in 1 short sentence. Do not repeat profile info."
            });
          }

          const lower = userText.toLowerCase();

          const asksTodayPlan =
            lower.includes("today") ||
            lower.includes("plan today") ||
            lower.includes("what is plan today") ||
            lower.includes("plan for today") ||
            lower.includes("today workout") ||
            lower.includes("today we do what") ||
            lower.includes("practice chest") ||
            lower.includes("practice back") ||
            lower.includes("practice legs") ||
            lower.includes("hôm nay");

          const asksHistory =
            lower.includes("last week") ||
            lower.includes("this week") ||
            lower.includes("last month") ||
            lower.includes("what i did") ||
            lower.includes("what did i train") ||
            lower.includes("report") ||
            lower.includes("history") ||
            lower.includes("tuần trước") ||
            lower.includes("tuần này") ||
            lower.includes("tháng trước");

          if (asksTodayPlan && !asksHistory) {
            messages.push({
              role: "system",
              content: `
The user is asking for today's workout plan.

You MUST:
- give a workout plan immediately
- use recent workout history to avoid repeating the same muscle group
- be concise and practical

DO NOT:
- summarize last week
- repeat profile info
- talk about stored profile unless necessary

Just give today's plan.
`
            });
          }

          if (asksHistory) {
            messages.push({
              role: "system",
              content: `
The user is asking about workout history.

Today is 2026-03-19.

Interpret time ranges like this:
- "last week" = recent sessions around 2026-03-12 to 2026-03-18
- "this week" = sessions around 2026-03-17 to 2026-03-19
- "last month" = recent sessions from the previous few weeks

If workout history context contains sessions in those dates, summarize them directly.
Do NOT say "I don't have enough workout data" if workout history context is present.
Do NOT switch to today's plan unless the user asks for a plan.
`
            });
          }

          const mustSearch = shouldUseTavilySearch(userText);

          let iterations = 0;
          while (iterations < 4) {
            iterations += 1;

            const toolChoice: "auto" | { type: "function"; function: { name: string } } =
              mustSearch && iterations === 1
                ? { type: "function", function: { name: "tavily_search" } }
                : "auto";

            const choice = await openAIChatComplete({
              messages,
              tools: [tavilyTool],
              toolChoice
            });

            if (Array.isArray(choice.tool_calls) && choice.tool_calls.length > 0) {
              for (const tc of choice.tool_calls as OpenAIToolCall[]) {
                const name = tc.function?.name;
                if (name !== "tavily_search") continue;

                let query = userText;
                try {
                  const args = JSON.parse(tc.function.arguments || "{}") as { query?: unknown };
                  if (typeof args.query === "string" && args.query.trim()) {
                    query = args.query.trim();
                  }
                } catch {
                  // ignore malformed args
                }

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
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ type: "error", message } satisfies StreamEvent)}\n`
            )
          );
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