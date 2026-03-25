import { NextResponse } from "next/server";

import { loadUserContext } from "../../../lib/agent/context";
import { gymBroSystemPrompt, shouldUseTavilySearch } from "../../../lib/agent/gymbro";
import { tavilySearch } from "../../../lib/mcp/tavily";
import { supabaseServer } from "../../../lib/supabase/server";
import {
  openAIChatComplete,
  type OpenAIChatMessage,
  type OpenAIContentPart,
  type OpenAITool,
  type OpenAIToolCall
} from "../../../lib/tools/openai";
import type { StreamEvent } from "../../../lib/types";

export const dynamic = "force-dynamic";

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

type BodyMetricsPatch = {
  measured_at?: string;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  skeletal_muscle_kg?: number | null;
  bmi?: number | null;
  waist_cm?: number | null;
  chest_cm?: number | null;
  hip_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  note?: string | null;
  confidence?: number | null;
};

type BodyMetricsReportIntent = {
  metric: "weight_kg" | "body_fat_pct" | "waist_cm";
  range: "7d" | "30d" | "1y";
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
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  patch: ProfilePatch
) {
  const payload: Record<string, string | number | null> = {};

  if ("display_name" in patch) payload.display_name = patch.display_name ?? null;
  if ("weight_kg" in patch) payload.weight_kg = patch.weight_kg ?? null;
  if ("height_cm" in patch) payload.height_cm = patch.height_cm ?? null;
  if ("age" in patch) payload.age = patch.age ?? null;
  if ("gender" in patch) payload.gender = patch.gender ?? null;

  const { error } = await supabase
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

function parseBodyMetricsReportIntent(text: string): BodyMetricsReportIntent | null {
  const t = text.trim().toLowerCase();
  const isReport =
    t.includes("report") ||
    t.includes("trend") ||
    t.includes("progress") ||
    t.includes("biểu đồ") ||
    t.includes("xu hướng") ||
    t.includes("tiến triển") ||
    t.includes("báo cáo");
  const isBody =
    t.includes("body") ||
    t.includes("cân") ||
    t.includes("weight") ||
    t.includes("body fat") ||
    t.includes("% mỡ") ||
    t.includes("mỡ") ||
    t.includes("waist") ||
    t.includes("vòng eo") ||
    t.includes("eo");

  if (!isReport || !isBody) return null;

  let range: BodyMetricsReportIntent["range"] = "30d";
  if (t.includes("7 day") || t.includes("7d") || t.includes("7 ngày")) range = "7d";
  if (t.includes("30 day") || t.includes("30d") || t.includes("30 ngày")) range = "30d";
  if (t.includes("1 year") || t.includes("1y") || t.includes("1 năm") || t.includes("12 tháng")) range = "1y";

  let metric: BodyMetricsReportIntent["metric"] = "weight_kg";
  if (t.includes("body fat") || t.includes("%") || t.includes("% mỡ") || t.includes("mỡ")) metric = "body_fat_pct";
  if (t.includes("waist") || t.includes("vòng eo") || (t.includes("eo") && !t.includes("heo"))) metric = "waist_cm";
  if (t.includes("weight") || t.includes("cân") || t.includes("kg")) metric = "weight_kg";

  return { metric, range };
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function extractFirstJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function parseBodyMetricsPatchFromLLM(text: string): BodyMetricsPatch | null {
  const obj = extractFirstJsonObject(text);
  if (!obj || typeof obj !== "object") return null;

  const root = obj as Record<string, unknown>;
  const metrics = (root.metrics && typeof root.metrics === "object" ? (root.metrics as Record<string, unknown>) : root) as Record<
    string,
    unknown
  >;

  const measured_at = typeof root.measured_at === "string" ? root.measured_at : undefined;
  const note = typeof root.note === "string" ? root.note : undefined;
  const confidence = clampNumber(root.confidence, 0, 1);

  return {
    measured_at,
    weight_kg: clampNumber(metrics.weight_kg, 20, 300),
    body_fat_pct: clampNumber(metrics.body_fat_pct, 1, 80),
    muscle_mass_kg: clampNumber(metrics.muscle_mass_kg, 5, 120),
    skeletal_muscle_kg: clampNumber(metrics.skeletal_muscle_kg, 5, 80),
    bmi: clampNumber(metrics.bmi, 10, 60),
    waist_cm: clampNumber(metrics.waist_cm, 30, 200),
    chest_cm: clampNumber(metrics.chest_cm, 30, 200),
    hip_cm: clampNumber(metrics.hip_cm, 30, 220),
    arm_cm: clampNumber(metrics.arm_cm, 15, 80),
    thigh_cm: clampNumber(metrics.thigh_cm, 25, 120),
    note: note ? note.slice(0, 200) : undefined,
    confidence
  };
}

function bodyMetricsSavedText(patch: BodyMetricsPatch) {
  const parts: string[] = [];
  if (typeof patch.weight_kg === "number") parts.push(`Weight: ${patch.weight_kg}kg`);
  if (typeof patch.body_fat_pct === "number") parts.push(`Body fat: ${patch.body_fat_pct}%`);
  if (typeof patch.muscle_mass_kg === "number") parts.push(`Muscle mass: ${patch.muscle_mass_kg}kg`);
  if (typeof patch.skeletal_muscle_kg === "number") parts.push(`Skeletal muscle: ${patch.skeletal_muscle_kg}kg`);
  if (typeof patch.bmi === "number") parts.push(`BMI: ${patch.bmi}`);
  if (typeof patch.waist_cm === "number") parts.push(`Waist: ${patch.waist_cm}cm`);
  if (typeof patch.chest_cm === "number") parts.push(`Chest: ${patch.chest_cm}cm`);
  if (typeof patch.hip_cm === "number") parts.push(`Hip: ${patch.hip_cm}cm`);
  if (typeof patch.arm_cm === "number") parts.push(`Arm: ${patch.arm_cm}cm`);
  if (typeof patch.thigh_cm === "number") parts.push(`Thigh: ${patch.thigh_cm}cm`);

  const header = "I extracted your body metrics from the image and saved them.";
  const list = parts.length ? `\n- ${parts.join("\n- ")}` : "\n(No readable metrics found in the image.)";
  const conf =
    typeof patch.confidence === "number" ? `\nConfidence: ${Math.round(patch.confidence * 100)}%` : "";

  return `${header}${list}${conf}`;
}

function metricLabel(metric: BodyMetricsReportIntent["metric"]) {
  if (metric === "weight_kg") return "Weight";
  if (metric === "body_fat_pct") return "Body fat";
  return "Waist";
}

function normalizeShort(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

type ParsedSet = {
  weightKg: number | null;
  reps: number;
  repeat: number;
  isBodyweight: boolean;
};

function parseSetChunk(chunk: string): ParsedSet | null {
  const t = chunk.trim().toLowerCase();
  if (!t) return null;

  const bw = t
    .replace(/\s+/g, " ")
    .replace(/^bodyweight\b/, "bw")
    .replace(/^body weight\b/, "bw")
    .trim();

  const bwMatch = bw.match(/^bw\s*(?:kg)?\s*(?:x|×)\s*(\d+)(?:\s*(?:x|×)\s*(\d+))?$/i);
  if (bwMatch) {
    const reps = Number(bwMatch[1]);
    const repeat = bwMatch[2] ? Number(bwMatch[2]) : 1;
    if (!Number.isFinite(reps) || reps <= 0) return null;
    if (!Number.isFinite(repeat) || repeat <= 0) return null;
    return { weightKg: null, reps, repeat, isBodyweight: true };
  }

  const m = t.match(
    /^(\d+(?:\.\d+)?)\s*(?:kg)?\s*(?:x|×)\s*(\d+)(?:\s*(?:x|×)\s*(\d+))?$/
  );
  if (!m) return null;
  const weightKg = Number(m[1]);
  const reps = Number(m[2]);
  const repeat = m[3] ? Number(m[3]) : 1;
  if (!Number.isFinite(weightKg) || weightKg < 0) return null;
  if (!Number.isFinite(reps) || reps <= 0) return null;
  if (!Number.isFinite(repeat) || repeat <= 0) return null;
  return { weightKg, reps, repeat, isBodyweight: false };
}

function parseSetLogInput(text: string): ParsedSet[] | null {
  const chunks = text
    .split(/[,\n;]/g)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!chunks.length) return null;

  const parsed: ParsedSet[] = [];
  for (const c of chunks) {
    const p = parseSetChunk(c.replace(/\s*(?:kg)?\s*(?:x|×)\s*/gi, (m) => m.replace(/\s+/g, "")));
    if (!p) return null;
    parsed.push(p);
  }

  return parsed.length ? parsed : null;
}

type ChatIntent =
  | { kind: "start" }
  | { kind: "resume" }
  | { kind: "restart_today" }
  | { kind: "next_exercise" }
  | { kind: "finish_exercise" }
  | { kind: "end_session" }
  | { kind: "plan_today" }
  | { kind: "plan_this_week" }
  | { kind: "report_today" }
  | { kind: "report_last_week" }
  | { kind: "report_last_month" }
  | { kind: "report_last_year" }
  | { kind: "body_metrics" }
  | { kind: "weight_trend" }
  | { kind: "body_fat_trend" }
  | { kind: "waist_trend" }
  | { kind: "set_log"; sets: ParsedSet[] };

function parseIntent(text: string): ChatIntent | null {
  const t = normalizeShort(text);
  if (!t) return null;

  const setLog = parseSetLogInput(t.replace(/\s+/g, ""));
  if (setLog) return { kind: "set_log", sets: setLog };

  if (t === "start" || t === "start workout" || t === "begin workout" || t === "begin" || t === "start session")
    return { kind: "start" };
  if (t === "/resume" || t === "resume") return { kind: "resume" };
  if (t === "/restart_today" || t === "restart today session" || t === "restart") return { kind: "restart_today" };
  if (t === "/next" || t === "next exercise") return { kind: "next_exercise" };
  if (t === "/finish_exercise" || t === "finish exercise") return { kind: "finish_exercise" };
  if (t === "/end" || t === "end session") return { kind: "end_session" };

  const asksPlanToday =
    t === "what is plan today" ||
    t === "plan today" ||
    t === "today plan" ||
    t === "what is plan for today" ||
    t === "what is plan today?" ||
    ((t.includes("plan") || t.includes("kế hoạch") || t.includes("lịch tập")) &&
      (t.includes("today") || t.includes("hôm nay")));
  if (asksPlanToday) return { kind: "plan_today" };

  const asksPlanWeek =
    t === "what is plan this week" ||
    t === "plan this week" ||
    t === "week plan" ||
    t === "weekly plan" ||
    (t.includes("plan") && t.includes("this week")) ||
    ((t.includes("kế hoạch") || t.includes("lịch tập")) && t.includes("tuần này"));
  if (asksPlanWeek) return { kind: "plan_this_week" };

  if (t === "report today" || t === "today report" || (t.includes("report") && t.includes("today")) || (t.includes("báo cáo") && t.includes("hôm nay")))
    return { kind: "report_today" };
  if (
    t === "report last week" ||
    t === "weekly report" ||
    t === "last week report" ||
    (t.includes("report") && t.includes("last week")) ||
    (t.includes("báo cáo") && t.includes("tuần trước"))
  )
    return { kind: "report_last_week" };
  if (
    t === "report last month" ||
    t === "monthly report" ||
    t === "last month report" ||
    (t.includes("report") && t.includes("last month")) ||
    (t.includes("báo cáo") && t.includes("tháng trước"))
  )
    return { kind: "report_last_month" };
  if (
    t === "report last year" ||
    t === "yearly report" ||
    t === "last year report" ||
    (t.includes("report") && t.includes("last year")) ||
    (t.includes("báo cáo") && t.includes("năm"))
  )
    return { kind: "report_last_year" };

  if (
    t === "body metrics" ||
    t === "show body metrics" ||
    t === "show chỉ số cơ thể" ||
    t === "show metrics" ||
    t === "body stats" ||
    t === "show body" ||
    t === "show body stats" ||
    t.includes("body metrics") ||
    t.includes("chỉ số cơ thể")
  )
    return { kind: "body_metrics" };
  if (t === "weight trend" || t === "cân trend" || t === "xu hướng cân nặng") return { kind: "weight_trend" };
  if (t === "body fat trend" || t === "xu hướng mỡ" || t === "xu hướng % mỡ") return { kind: "body_fat_trend" };
  if (t === "waist trend" || t === "xu hướng vòng eo" || t === "vòng eo trend") return { kind: "waist_trend" };

  return null;
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
          const imageDataUrl =
            typeof bodyObj.imageDataUrl === "string" && bodyObj.imageDataUrl.startsWith("data:image/")
              ? bodyObj.imageDataUrl
              : null;

          if (!userText && !imageDataUrl) {
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

          const userId = user.id;

          let threadId = threadIdInput;
          if (threadId) {
            const { data: thread } = await supabase
              .from("chat_threads")
              .select("id")
              .eq("id", threadId)
              .eq("user_id", userId)
              .maybeSingle();
            if (!thread) threadId = null;
          }

          if (!threadId) {
            const id = crypto.randomUUID();
            const createdRes = await supabase
              .from("chat_threads")
              .insert({ id, user_id: userId, title: "Gym Bro" })
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

          const userMessageId = crypto.randomUUID();
          {
            const ins = await supabase.from("chat_messages").insert({
              id: userMessageId,
              user_id: userId,
              role: "user",
              content: userText || "Image uploaded",
              metadata: imageDataUrl ? { has_image: true } : {}
            });
            if (ins.error) throw new Error(`Failed to save user message: ${ins.error.message}`);
          }

          if (imageDataUrl) {
            const visionSystem = `
You are a fitness coach inside a private app.

Task: Extract body metrics from the uploaded image (smart scale / InBody / screenshot).

Return ONLY valid JSON with this shape:
{
  "measured_at": "ISO timestamp or null",
  "metrics": {
    "weight_kg": number or null,
    "body_fat_pct": number or null,
    "muscle_mass_kg": number or null,
    "skeletal_muscle_kg": number or null,
    "bmi": number or null,
    "waist_cm": number or null,
    "chest_cm": number or null,
    "hip_cm": number or null,
    "arm_cm": number or null,
    "thigh_cm": number or null
  },
  "note": "short note or null",
  "confidence": number from 0 to 1
}

Rules:
- Do not guess. Use null if you cannot read a value.
- Use kg, cm, and %.
- If the image contains multiple measurements, extract the most recent one.
`;

            const contentParts: OpenAIContentPart[] = [
              { type: "text", text: userText || "Extract body metrics from this image." },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ];

            const choice = await openAIChatComplete({
              messages: [
                { role: "system", content: visionSystem },
                { role: "user", content: contentParts }
              ]
            });

            const assistantRaw = typeof choice.content === "string" ? choice.content.trim() : "";
            const patch = assistantRaw ? parseBodyMetricsPatchFromLLM(assistantRaw) : null;

            if (!patch) {
              const assistantText =
                "I couldn't reliably read the metrics from that image. Try a clearer screenshot (full screen, high contrast), or type the numbers and I’ll log them.";

              const id = crypto.randomUUID();
              const ins = await supabase.from("chat_messages").insert({
                id,
                user_id: userId,
                role: "assistant",
                content: assistantText,
                metadata: { kind: "body_metrics_extract_failed" }
              });
              if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);

              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            let measuredAt = new Date().toISOString();
            if (typeof patch.measured_at === "string" && patch.measured_at.trim()) {
              const d = new Date(patch.measured_at);
              if (Number.isFinite(d.getTime())) measuredAt = d.toISOString();
            }

            const clientForMetrics = await supabaseServer();
            const insertRes = await clientForMetrics
              .from("body_metrics")
              .insert({
                user_id: userId,
                measured_at: measuredAt,
                weight_kg: patch.weight_kg ?? null,
                body_fat_pct: patch.body_fat_pct ?? null,
                muscle_mass_kg: patch.muscle_mass_kg ?? null,
                skeletal_muscle_kg: patch.skeletal_muscle_kg ?? null,
                bmi: patch.bmi ?? null,
                waist_cm: patch.waist_cm ?? null,
                chest_cm: patch.chest_cm ?? null,
                hip_cm: patch.hip_cm ?? null,
                arm_cm: patch.arm_cm ?? null,
                thigh_cm: patch.thigh_cm ?? null,
                note: patch.note ?? null,
                source: "image"
              })
              .select("id")
              .single();
            if (insertRes.error) {
              throw new Error(`Failed to save body metrics: ${insertRes.error.message}`);
            }

            // success path continues

            const assistantText = bodyMetricsSavedText(patch);
            {
              const id = crypto.randomUUID();
              const ins = await supabase.from("chat_messages").insert({
                id,
                user_id: userId,
                role: "assistant",
                content: assistantText,
                metadata: { kind: "body_metrics_saved", body_metrics_id: insertRes.data?.id ?? null }
              });
              if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
            }

            send({ type: "assistant", content: assistantText });
            controller.close();
            return;
          }

          // deterministic profile handling
          const profileIntent = parseProfilePatch(userText);
          if (profileIntent) {
            await applyProfilePatch(supabase, userId, profileIntent.patch);

            const assistantText = profileConfirmationText(
              profileIntent.patch,
              profileIntent.reset
            );

            const id = crypto.randomUUID();
            const ins = await supabase.from("chat_messages").insert({
              id,
              thread_id: threadId,
              user_id: userId,
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

          async function logToolExecution(args: {
            tool_name: string;
            input: Record<string, unknown>;
            output?: Record<string, unknown> | null;
            status?: "success" | "failed" | "pending";
            error_message?: string | null;
          }) {
            const ins = await supabase.from("tool_executions").insert({
              user_id: userId,
              thread_id: threadId,
              message_id: userMessageId,
              tool_name: args.tool_name,
              input: args.input,
              output: args.output ?? null,
              status: args.status ?? "success",
              error_message: args.error_message ?? null
            });
            if (ins.error) throw new Error(`Failed to save tool execution: ${ins.error.message}`);
          }

          async function saveAssistantMessage(content: string, metadata: Record<string, unknown>) {
            const id = crypto.randomUUID();
            const ins = await supabase.from("chat_messages").insert({
              id,
              thread_id: threadId,
              user_id: userId,
              role: "assistant",
              content,
              metadata
            });
            if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
          }

          function safeJson<T>(text: string | null | undefined): T | null {
            if (!text) return null;
            try {
              return JSON.parse(text) as T;
            } catch {
              return null;
            }
          }

          function isoDate(d: Date) {
            return d.toISOString().slice(0, 10);
          }

          function startOfWeekMonday(date: Date) {
            const d = new Date(date);
            const day = d.getDay();
            const diff = (day + 6) % 7;
            d.setDate(d.getDate() - diff);
            d.setHours(0, 0, 0, 0);
            return d;
          }

          async function getActiveSessionToday() {
            const today = isoDate(new Date());
            const { data } = await supabase
              .from("workout_sessions")
              .select("id, title, status, session_date")
              .eq("user_id", userId)
              .eq("session_date", today)
              .eq("status", "in_progress")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            return data as { id: string; title: string | null; status: string | null; session_date: string | null } | null;
          }

          async function getSessionProgress(sessionId: string) {
            const { data: exercisesData, error: exErr } = await supabase
              .from("workout_exercises")
              .select("id, exercise_name, exercise_order, notes")
              .eq("session_id", sessionId)
              .order("exercise_order", { ascending: true });
            if (exErr) throw new Error(`Failed to load exercises: ${exErr.message}`);
            const exercises =
              (exercisesData as Array<{ id: string; exercise_name: string | null; exercise_order: number | null; notes: string | null }> | null | undefined) ??
              [];
            if (!exercises.length) return { exercises, activeIndex: -1, activeExercise: null as null | typeof exercises[number] };

            const { data: setsData } = await supabase
              .from("workout_sets")
              .select("exercise_id, is_warmup")
              .in(
                "exercise_id",
                exercises.map((e) => e.id)
              )
              .limit(2000);

            const counts = new Map<string, number>();
            for (const s of (setsData as Array<{ exercise_id: string; is_warmup: boolean | null }> | null | undefined) ?? []) {
              if (s.is_warmup) continue;
              counts.set(s.exercise_id, (counts.get(s.exercise_id) || 0) + 1);
            }

            const doneFlags = exercises.map((e) => {
              const meta = safeJson<{ target_sets?: unknown; force_completed?: unknown }>(e.notes);
              const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
              const forceCompleted = meta?.force_completed === true;
              const completed = counts.get(e.id) || 0;
              const done = forceCompleted || (typeof targetSets === "number" ? completed >= targetSets : false);
              return { id: e.id, targetSets, completed, done };
            });

            let activeIndex = doneFlags.findIndex((d) => !d.done);
            if (activeIndex === -1) activeIndex = doneFlags.length - 1;
            return { exercises, doneFlags, activeIndex, activeExercise: exercises[activeIndex] };
          }

          function buildWorkoutSessionText(args: {
            sessionTitle: string;
            exerciseName: string;
            targetText: string | null;
            cues: string | null;
            exerciseIndex: number;
            exerciseTotal: number;
            completedSets: number;
            targetSets: number | null;
            headerLine?: string | null;
          }) {
            const progressSets =
              typeof args.targetSets === "number"
                ? `Set ${Math.min(args.completedSets, args.targetSets)}/${args.targetSets}`
                : `Sets ${args.completedSets}`;
            const header = args.headerLine ? `${args.headerLine}\n\n` : "";
            return (
              `${header}Workout Session\n` +
              `Session: ${args.sessionTitle}\n` +
              `Exercise: ${args.exerciseName}\n` +
              (args.targetText ? `Target: ${args.targetText}\n` : "") +
              (args.cues ? `Cues: ${args.cues}\n` : "") +
              `Progress: Exercise ${Math.max(args.exerciseIndex + 1, 1)}/${Math.max(args.exerciseTotal, 1)} • ${progressSets}`
            );
          }

          async function ensureActivePlan() {
            const clientWithAuth = await supabaseServer();
            const dbgSession = await clientWithAuth.auth.getSession();
            const dbgUser = await clientWithAuth.auth.getUser();
            console.log("ensureActivePlan.auth.session", {
              hasSession: Boolean(dbgSession.data.session),
              userId: dbgUser.data.user?.id || null
            });
            const existing = await clientWithAuth
              .from("workout_plans")
              .select("id, title")
              .eq("user_id", userId)
              .eq("is_active", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing.data?.id) {
              const { count: daysCount } = await clientWithAuth
                .from("workout_plan_days")
                .select("id", { count: "exact" })
                .eq("plan_id", existing.data.id);

              if (daysCount && daysCount > 0) {
                const { count: exercisesCount } = await clientWithAuth
                  .from("workout_plan_day_exercises")
                  .select("id", { count: "exact" })
                  .in(
                    "plan_day_id",
                    (
                      await clientWithAuth
                        .from("workout_plan_days")
                        .select("id")
                        .eq("plan_id", existing.data.id)
                    ).data?.map((d) => d.id) ?? []
                  );

                if (exercisesCount && exercisesCount > 0) {
                  return existing.data as { id: string; title: string | null };
                }
              }

              // If the existing plan is empty, mark it as inactive
              await clientWithAuth
                .from("workout_plans")
                .update({ is_active: false })
                .eq("id", existing.data.id);
            }

            const ctx = await loadUserContext({ supabase, userId });
            const sys = `
You are Gym Bro. Generate a weekly workout plan for hypertrophy.

Return ONLY valid JSON with shape:
{
  "title": string,
  "days": [
    {
      "day_of_week": 0-6 (Sun=0),
      "title": string,
      "session_type": string,
      "exercises": [
        {
          "exercise_name": string,
          "muscle_group": string,
          "target_sets": number,
          "target_reps_min": number,
          "target_reps_max": number,
          "target_rpe": number or null,
          "cues": string
        }
      ]
    }
  ]
}

Rules:
- 4 to 6 training days is fine.
- Use common gym equipment.
- Keep cues short (1-2 sentences max).
- Use muscle_group like: chest/back/legs/shoulders/arms/core.
`;

            const choice = await openAIChatComplete({
              messages: [
                { role: "system", content: sys },
                { role: "user", content: `Context:\n${ctx.profileText}\n${ctx.memoriesText}\nGoal: gain muscle` }
              ]
            });

            const raw = typeof choice.content === "string" ? choice.content.trim() : "";
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start === -1 || end === -1 || end <= start) throw new Error("Plan generation failed");
            const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;

            const isRecord = (v: unknown): v is Record<string, unknown> =>
              typeof v === "object" && v !== null && !Array.isArray(v);

            if (!isRecord(parsed)) throw new Error("Plan generation failed");

            const titleRaw = parsed.title;
            const title =
              typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : "Weekly Plan";

            const daysRaw = parsed.days;
            const days = Array.isArray(daysRaw) ? daysRaw : [];
            if (days.length < 3) throw new Error("Plan generation returned too few days");

            const upd = await clientWithAuth.from("workout_plans").update({ is_active: false }).eq("user_id", userId).eq("is_active", true);
            if (upd.error) {
              console.error("ensureActivePlan.update_error", upd.error);
            }

            const planId = crypto.randomUUID();
            const payload = { id: planId, user_id: userId, title, description: null, is_active: true };
            console.log("ensureActivePlan.insert_payload", payload);
            const planIns = await clientWithAuth
              .from("workout_plans")
              .insert(payload)
              .select("id")
              .single();
            if (planIns.error) {
              console.error("ensureActivePlan.insert_error", planIns.error);
              throw new Error(`Failed to save plan: ${planIns.error.message}`);
            }

            type PlanDayRow = {
              id: string;
              plan_id: string;
              day_of_week: number | null;
              title: string;
              session_type: string | null;
              notes: string | null;
              display_order: number;
            };

            type PlanDayExerciseRow = {
              id: string;
              plan_day_id: string;
              exercise_name: string;
              muscle_group: string | null;
              target_sets: number;
              target_reps_min: number;
              target_reps_max: number;
              target_rpe: number | null;
              display_order: number;
              cues: string;
            };

            const dayRows: PlanDayRow[] = [];
            const exRows: PlanDayExerciseRow[] = [];
            for (let i = 0; i < days.length; i++) {
              const d = days[i];
              const dObj = isRecord(d) ? d : {};
              const dayId = crypto.randomUUID();
              const dayOfWeek = typeof dObj.day_of_week === "number" ? dObj.day_of_week : null;
              const dayTitle = typeof dObj.title === "string" ? dObj.title : `Day ${i + 1}`;
              const sessionType = typeof dObj.session_type === "string" ? dObj.session_type : null;
              dayRows.push({
                id: dayId,
                plan_id: planId,
                day_of_week: dayOfWeek,
                title: dayTitle,
                session_type: sessionType,
                notes: null,
                display_order: i + 1
              });

              const exercisesRaw = dObj.exercises;
              const exercises = Array.isArray(exercisesRaw) ? exercisesRaw : [];
              for (let j = 0; j < exercises.length; j++) {
                const e = exercises[j];
                const eObj = isRecord(e) ? e : {};
                exRows.push({
                  id: crypto.randomUUID(),
                  plan_day_id: dayId,
                  exercise_name:
                    typeof eObj.exercise_name === "string" ? eObj.exercise_name : `Exercise ${j + 1}`,
                  muscle_group: typeof eObj.muscle_group === "string" ? eObj.muscle_group : null,
                  target_sets: typeof eObj.target_sets === "number" ? eObj.target_sets : 3,
                  target_reps_min: typeof eObj.target_reps_min === "number" ? eObj.target_reps_min : 8,
                  target_reps_max: typeof eObj.target_reps_max === "number" ? eObj.target_reps_max : 12,
                  target_rpe: typeof eObj.target_rpe === "number" ? eObj.target_rpe : null,
                  display_order: j + 1,
                  cues: typeof eObj.cues === "string" ? eObj.cues : ""
                });
              }
            }

            if (dayRows.length) {
              const insDays = await supabase.from("workout_plan_days").insert(dayRows);
              if (insDays.error) throw new Error(`Failed to save plan days: ${insDays.error.message}`);
            }
            if (exRows.length) {
              const insEx = await supabase.from("workout_plan_day_exercises").insert(exRows);
              if (insEx.error) throw new Error(`Failed to save plan exercises: ${insEx.error.message}`);
            }

            return { id: planId, title };
          }

          async function buildPlanText(args: { planId: string; scope: "today" | "week"; inProgress: boolean }) {
            const { data: daysData, error: dErr } = await supabase
              .from("workout_plan_days")
              .select("id, day_of_week, title, session_type, display_order")
              .eq("plan_id", args.planId)
              .order("display_order", { ascending: true });
            if (dErr) throw new Error(`Failed to load plan days: ${dErr.message}`);

            const days = (daysData as Array<{ id: string; day_of_week: number | null; title: string; session_type: string | null; display_order: number | null }> | null | undefined) ?? [];
            const today = new Date();
            const dow = today.getDay();

            const chosen =
              args.scope === "today"
                ? days.filter((d) => d.day_of_week === dow).slice(0, 1).length
                  ? days.filter((d) => d.day_of_week === dow).slice(0, 1)
                  : days.slice(0, 1)
                : days;

            const dayIds = chosen.map((d) => d.id);
            const { data: exData, error: eErr } = await supabase
              .from("workout_plan_day_exercises")
              .select("plan_day_id, exercise_name, muscle_group, target_sets, target_reps_min, target_reps_max, target_rpe, display_order, cues")
              .in("plan_day_id", dayIds)
              .order("display_order", { ascending: true });
            if (eErr) throw new Error(`Failed to load plan exercises: ${eErr.message}`);
            type PlanDayExerciseRow = {
              plan_day_id: string;
              exercise_name: string | null;
              muscle_group: string | null;
              target_sets: number | null;
              target_reps_min: number | null;
              target_reps_max: number | null;
              target_rpe: number | null;
              display_order: number | null;
              cues: string | null;
            };

            const exRows = (exData as PlanDayExerciseRow[] | null | undefined) ?? [];
            const byDay = new Map<string, PlanDayExerciseRow[]>();
            for (const r of exRows) {
              const arr = byDay.get(String(r.plan_day_id)) || [];
              arr.push(r);
              byDay.set(String(r.plan_day_id), arr);
            }

            const lines: string[] = [];
            const title = args.scope === "today" ? "Today’s Plan" : "Weekly Plan";
            lines.push(title);

            for (let i = 0; i < chosen.length; i++) {
              const d = chosen[i];
              const isToday = args.scope === "today" || d.day_of_week === dow;
              const inProg = args.inProgress && isToday;
              const dayLabel = `Day ${i + 1}: ${args.scope === "today" ? "Today - " : ""}${d.title}${isToday ? " (Today)" : ""}${inProg ? " [In progress]" : ""}`;
              lines.push("");
              lines.push(dayLabel);

              const ex = byDay.get(d.id) || [];
              const mainMuscle = ex[0]?.muscle_group ? String(ex[0].muscle_group) : "";
              if (mainMuscle) lines.push(`Target: ${mainMuscle}`);
              for (const row of ex) {
                const sets = typeof row.target_sets === "number" ? row.target_sets : 3;
                const rMin = typeof row.target_reps_min === "number" ? row.target_reps_min : 8;
                const rMax = typeof row.target_reps_max === "number" ? row.target_reps_max : rMin;
                const reps = rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`;
                lines.push(`- ${String(row.exercise_name)} — ${sets}x${reps}`);
              }
              const cues = ex
                .map((r) => (typeof r.cues === "string" ? r.cues.trim() : ""))
                .filter(Boolean)[0];
              if (cues) lines.push(`Cues: ${cues}`);
            }

            return lines.join("\n");
          }

          async function handleReport(range: "today" | "last_week" | "last_month" | "last_year") {
            const now = new Date();
            const today = isoDate(now);

            if (range === "today") {
              const { data: sess } = await supabase
                .from("workout_sessions")
                .select("id")
                .eq("user_id", userId)
                .eq("session_date", today)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (!sess?.id) {
                return "Weekly Report\nTraining Summary: No session logged today.\nNext Steps: Type start to begin today’s workout.";
              }

              const { data: summary } = await supabase
                .from("workout_session_summary_v")
                .select("total_exercises, total_sets, total_reps, total_volume, session_type, title")
                .eq("session_id", sess.id)
                .maybeSingle();

              const { data: details } = await supabase
                .from("workout_set_details_v")
                .select("muscle_group, set_id, is_warmup")
                .eq("session_id", sess.id);

              const mf = new Map<string, number>();
              type SetDetailRow = { muscle_group: string | null; is_warmup: boolean | null };
              for (const r of (details as SetDetailRow[] | null | undefined) ?? []) {
                if (r.is_warmup) continue;
                const mg = typeof r.muscle_group === "string" ? r.muscle_group : "other";
                mf.set(mg, (mf.get(mg) || 0) + 1);
              }

              const freqLines = Array.from(mf.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([k, v]) => `${k}: ${v}x`)
                .join("\n");

              const totalSessions = 1;
              const totalSets = summary?.total_sets ?? 0;
              const totalReps = summary?.total_reps ?? 0;
              const totalVol = summary?.total_volume ?? 0;
              const strongest = Array.from(mf.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

              return [
                "Weekly Report",
                `Training Summary: ${summary?.title || "Today"} • ${summary?.session_type || "session"}`,
                `Score: ${totalSets ? "7.5/10" : ""}`.trim(),
                `Muscle Groups Trained:\n${freqLines || "—"}`,
                `Strongest Area: ${strongest || "—"}`,
                `Progression Highlights: Total volume ${Number(totalVol).toFixed(0)}`,
                `Next Steps: Keep the same main lifts and try +1 rep next time.`,
                `Evaluation: Sessions ${totalSessions}, Sets ${totalSets}, Reps ${totalReps}, Volume ${Number(totalVol).toFixed(0)}`
              ]
                .filter(Boolean)
                .join("\n");
            }

            if (range === "last_week") {
              const weekStart = startOfWeekMonday(now);
              const lastWeekStart = new Date(weekStart);
              lastWeekStart.setDate(lastWeekStart.getDate() - 7);
              const ws = isoDate(lastWeekStart);

              const { data: summary } = await supabase
                .from("workout_weekly_summary_v")
                .select("total_sessions, total_sets, total_reps, total_volume")
                .eq("user_id", userId)
                .eq("week_start", ws)
                .maybeSingle();

              const { data: mfRows } = await supabase
                .from("muscle_group_progress_v")
                .select("muscle_group, total_sets, total_volume")
                .eq("user_id", userId)
                .eq("week_start", ws);

              type MuscleProgressRow = {
                muscle_group: string | null;
                total_sets: number | null;
                total_volume: number | null;
              };
              const mf = (mfRows as MuscleProgressRow[] | null | undefined) ?? [];
              const freqLines = mf
                .slice()
                .sort((a, b) => (b.total_sets ?? 0) - (a.total_sets ?? 0))
                .slice(0, 10)
                .map((r) => `${String(r.muscle_group || "other")}: ${Number(r.total_sets || 0)}x`)
                .join("\n");

              const strongest = mf.slice().sort((a, b) => (b.total_sets ?? 0) - (a.total_sets ?? 0))[0]?.muscle_group ?? "—";

              return [
                "Weekly Report",
                `Training Summary: Week of ${ws}`,
                `Muscle Groups Trained:\n${freqLines || "—"}`,
                `Strongest Area: ${String(strongest)}`,
                `Weak Points: ${mf.length ? "Balance under-trained muscle groups next week." : "—"}`,
                `Progression Highlights: Total volume ${Number(summary?.total_volume || 0).toFixed(0)}`,
                `Score: ${summary?.total_sessions ? "8/10" : "—"}`,
                `Next Steps: Aim for +1 set on your weakest muscle group.`,
                `Evaluation: Sessions ${Number(summary?.total_sessions || 0)}, Sets ${Number(summary?.total_sets || 0)}, Reps ${Number(summary?.total_reps || 0)}, Volume ${Number(summary?.total_volume || 0).toFixed(0)}`
              ]
                .filter(Boolean)
                .join("\n");
            }

            if (range === "last_month") {
              const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              const ms = isoDate(monthStart);
              const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
              const me = isoDate(monthEnd);
              const { data: summary } = await supabase
                .from("workout_monthly_summary_v")
                .select("total_sessions, total_sets, total_reps, total_volume")
                .eq("user_id", userId)
                .eq("month_start", ms)
                .maybeSingle();

              const { data: details } = await supabase
                .from("workout_set_details_v")
                .select("muscle_group, is_warmup")
                .eq("user_id", userId)
                .gte("session_date", ms)
                .lt("session_date", me)
                .limit(20000);

              type SetDetailRow = { muscle_group: string | null; is_warmup: boolean | null };
              const mf = new Map<string, number>();
              for (const r of (details as SetDetailRow[] | null | undefined) ?? []) {
                if (r.is_warmup) continue;
                const mg = typeof r.muscle_group === "string" && r.muscle_group ? r.muscle_group : "other";
                mf.set(mg, (mf.get(mg) || 0) + 1);
              }

              const freqLines = Array.from(mf.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([k, v]) => `${k}: ${v}x`)
                .join("\n");

              const strongest = Array.from(mf.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

              return [
                "Monthly Report",
                `Training Summary: Month of ${ms}`,
                `Score: ${summary?.total_sessions ? "8/10" : "—"}`,
                `Muscle Groups Trained:\n${freqLines || "—"}`,
                `Strongest Area: ${strongest}`,
                `Weak Points: ${mf.size ? "Bring up the lowest-frequency muscle group." : "—"}`,
                `Progression Highlights: Total volume ${Number(summary?.total_volume || 0).toFixed(0)}`,
                `Next Steps: Keep frequency consistent and push your main lifts.`,
                `Evaluation: Sessions ${Number(summary?.total_sessions || 0)}, Sets ${Number(summary?.total_sets || 0)}, Reps ${Number(summary?.total_reps || 0)}, Volume ${Number(summary?.total_volume || 0).toFixed(0)}`
              ]
                .filter(Boolean)
                .join("\n");
            }

            const yearStart = new Date(now.getFullYear() - 1, 0, 1);
            const ys = isoDate(yearStart);
            const yearEnd = new Date(now.getFullYear(), 0, 1);
            const ye = isoDate(yearEnd);
            const { data: summary } = await supabase
              .from("workout_yearly_summary_v")
              .select("total_sessions, total_sets, total_reps, total_volume")
              .eq("user_id", userId)
              .eq("year_start", ys)
              .maybeSingle();

            const { data: details } = await supabase
              .from("workout_set_details_v")
              .select("muscle_group, is_warmup")
              .eq("user_id", userId)
              .gte("session_date", ys)
              .lt("session_date", ye)
              .limit(50000);

            type SetDetailRow = { muscle_group: string | null; is_warmup: boolean | null };
            const mf = new Map<string, number>();
            for (const r of (details as SetDetailRow[] | null | undefined) ?? []) {
              if (r.is_warmup) continue;
              const mg = typeof r.muscle_group === "string" && r.muscle_group ? r.muscle_group : "other";
              mf.set(mg, (mf.get(mg) || 0) + 1);
            }

            const freqLines = Array.from(mf.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([k, v]) => `${k}: ${v}x`)
              .join("\n");

            const strongest = Array.from(mf.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

            return [
              "Yearly Report",
              `Training Summary: Year starting ${ys}`,
              `Score: ${summary?.total_sessions ? "8/10" : "—"}`,
              `Muscle Groups Trained:\n${freqLines || "—"}`,
              `Strongest Area: ${strongest}`,
              `Weak Points: ${mf.size ? "Bring up the lowest-frequency muscle group." : "—"}`,
              `Progression Highlights: Total volume ${Number(summary?.total_volume || 0).toFixed(0)}`,
              `Next Steps: Set a clear progression goal for your top 3 lifts.`,
              `Evaluation: Sessions ${Number(summary?.total_sessions || 0)}, Sets ${Number(summary?.total_sets || 0)}, Reps ${Number(summary?.total_reps || 0)}, Volume ${Number(summary?.total_volume || 0).toFixed(0)}`
            ]
              .filter(Boolean)
              .join("\n");
          }

          const intent = !imageDataUrl && userText ? parseIntent(userText) : null;
          if (intent) {
            const activeSession = await getActiveSessionToday();

            if (intent.kind === "start") {
              if (activeSession?.id) {
                const assistantText =
                  "CONFIRM_RESUME_OR_RESTART\nYou already have an active session today.\nResume or restart?";
                await logToolExecution({
                  tool_name: "start",
                  input: { intent: "start", sessionExists: true },
                  output: { kind: "confirm_resume_or_restart" }
                });

                const id = crypto.randomUUID();
                const ins = await supabase.from("chat_messages").insert({
                  id,
                  thread_id: threadId,
                  user_id: userId,
                  role: "assistant",
                  content: assistantText,
                  metadata: { kind: "confirm_resume_or_restart" }
                });
                if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const plan = await ensureActivePlan();
              const today = new Date();
              const dow = today.getDay();
              const { data: todayDay } = await supabase
                .from("workout_plan_days")
                .select("id, title, session_type")
                .eq("plan_id", plan.id)
                .eq("day_of_week", dow)
                .order("display_order", { ascending: true })
                .limit(1)
                .maybeSingle();

              if (!todayDay?.id) {
                const assistantText = "No plan day found for today. Type plan this week to regenerate your weekly plan.";
                await logToolExecution({
                  tool_name: "start",
                  input: { intent: "start", planId: plan.id, dayOfWeek: dow },
                  output: { error: "missing_plan_day" },
                  status: "failed",
                  error_message: "missing_plan_day"
                });
                const id = crypto.randomUUID();
                const ins = await supabase.from("chat_messages").insert({
                  id,
                  thread_id: threadId,
                  user_id: userId,
                  role: "assistant",
                  content: assistantText,
                  metadata: { kind: "start_failed" }
                });
                if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const sessionId = crypto.randomUUID();
              const todayDate = isoDate(today);
              const clientForSession = await supabaseServer();
              const sIns = await clientForSession
                .from("workout_sessions")
                .insert({
                  id: sessionId,
                  user_id: userId,
                  thread_id: threadId,
                  session_date: todayDate,
                  title: todayDay.title,
                  session_type: todayDay.session_type,
                  status: "in_progress",
                  started_at: new Date().toISOString(),
                  source: "plan"
                })
                .select("id")
                .single();
              if (sIns.error) {
                throw new Error(`Failed to save session: ${sIns.error.message}`);
              }

              const { data: planEx } = await supabase
                .from("workout_plan_day_exercises")
                .select("exercise_name, muscle_group, target_sets, target_reps_min, target_reps_max, target_rpe, display_order, cues")
                .eq("plan_day_id", todayDay.id)
                .order("display_order", { ascending: true });

              type PlanExRow = {
                exercise_name: string | null;
                muscle_group: string | null;
                target_sets: number | null;
                target_reps_min: number | null;
                target_reps_max: number | null;
                target_rpe: number | null;
                display_order: number | null;
                cues: string | null;
              };

              const exRows = ((planEx as PlanExRow[] | null | undefined) ?? []).map((e, idx) => {
                const notes = JSON.stringify({
                  target_sets: typeof e.target_sets === "number" ? e.target_sets : 3,
                  target_reps_min: typeof e.target_reps_min === "number" ? e.target_reps_min : 8,
                  target_reps_max: typeof e.target_reps_max === "number" ? e.target_reps_max : typeof e.target_reps_min === "number" ? e.target_reps_min : 12,
                  target_rpe: typeof e.target_rpe === "number" ? e.target_rpe : null,
                  cues: typeof e.cues === "string" ? e.cues : ""
                });
                return {
                  id: crypto.randomUUID(),
                  session_id: sessionId,
                  exercise_order: typeof e.display_order === "number" ? e.display_order : idx + 1,
                  muscle_group: typeof e.muscle_group === "string" ? e.muscle_group : null,
                  exercise_name: typeof e.exercise_name === "string" ? e.exercise_name : `Exercise ${idx + 1}`,
                  notes
                };
              });

              if (exRows.length) {
                const clientForExercises = await supabaseServer();
                const exIns = await clientForExercises.from("workout_exercises").insert(exRows);
                if (exIns.error) {
                  const exIns2 = await supabase.from("workout_exercises").insert(exRows);
                  if (exIns2.error) throw new Error(`Failed to create exercises: ${exIns2.error.message}`);
                }
              }

              await logToolExecution({
                tool_name: "start",
                input: { intent: "start", planId: plan.id, sessionId },
                output: { status: "created" }
              });

              const progress = await getSessionProgress(sessionId);
              const active = progress.activeExercise;
              const meta = safeJson<{ target_sets?: number; target_reps_min?: number; target_reps_max?: number; cues?: string }>(active?.notes);
              const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
              const rMin = typeof meta?.target_reps_min === "number" ? meta.target_reps_min : null;
              const rMax = typeof meta?.target_reps_max === "number" ? meta.target_reps_max : rMin;
              const reps = rMin ? (rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`) : null;
              const targetText = targetSets && reps ? `${targetSets}x${reps}` : null;
              const cues = typeof meta?.cues === "string" && meta.cues.trim() ? meta.cues.trim() : null;
              const completedSets = progress.doneFlags?.find((d) => d.id === active?.id)?.completed ?? 0;

              const assistantText = buildWorkoutSessionText({
                sessionTitle: todayDay.title,
                exerciseName: active?.exercise_name || "Exercise",
                targetText,
                cues,
                exerciseIndex: progress.activeIndex,
                exerciseTotal: progress.exercises.length,
                completedSets,
                targetSets,
                headerLine: "Started"
              });

              {
                const id = crypto.randomUUID();
                const ins = await supabase.from("chat_messages").insert({
                  id,
                  thread_id: threadId,
                  user_id: userId,
                  role: "assistant",
                  content: assistantText,
                  metadata: { kind: "workout_session" }
                });
                if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
              }

              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "resume") {
              if (!activeSession?.id) {
                const assistantText = "No active workout session. Type start to begin today’s workout.";
                await logToolExecution({ tool_name: "resume", input: { intent: "resume" }, output: { status: "no_active_session" } });
                await saveAssistantMessage(assistantText, { kind: "resume_no_active_session" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }
              const progress = await getSessionProgress(activeSession.id);
              const active = progress.activeExercise;
              const meta = safeJson<{ target_sets?: number; target_reps_min?: number; target_reps_max?: number; cues?: string }>(active?.notes);
              const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
              const rMin = typeof meta?.target_reps_min === "number" ? meta.target_reps_min : null;
              const rMax = typeof meta?.target_reps_max === "number" ? meta.target_reps_max : rMin;
              const reps = rMin ? (rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`) : null;
              const targetText = targetSets && reps ? `${targetSets}x${reps}` : null;
              const cues = typeof meta?.cues === "string" && meta.cues.trim() ? meta.cues.trim() : null;
              const completedSets = progress.doneFlags?.find((d) => d.id === active?.id)?.completed ?? 0;
              const assistantText = buildWorkoutSessionText({
                sessionTitle: activeSession.title || "Session",
                exerciseName: active?.exercise_name || "Exercise",
                targetText,
                cues,
                exerciseIndex: progress.activeIndex,
                exerciseTotal: progress.exercises.length,
                completedSets,
                targetSets,
                headerLine: "Resumed"
              });
              await logToolExecution({ tool_name: "resume", input: { intent: "resume", sessionId: activeSession.id }, output: { status: "ok" } });
              await saveAssistantMessage(assistantText, { kind: "workout_session" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "restart_today") {
              if (!activeSession?.id) {
                const assistantText = "No active workout session to restart. Type start to begin today’s workout.";
                await logToolExecution({ tool_name: "restart_today", input: { intent: "restart_today" }, output: { status: "no_active_session" } });
                await saveAssistantMessage(assistantText, { kind: "restart_no_active_session" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }
              const plan = await ensureActivePlan();
              const dow = new Date().getDay();
              const { data: todayDay } = await supabase
                .from("workout_plan_days")
                .select("id, title, session_type")
                .eq("plan_id", plan.id)
                .eq("day_of_week", dow)
                .order("display_order", { ascending: true })
                .limit(1)
                .maybeSingle();
              if (!todayDay?.id) {
                const assistantText = "No plan day found for today. Type plan this week to regenerate your weekly plan.";
                await logToolExecution({ tool_name: "restart_today", input: { intent: "restart_today" }, output: { error: "missing_plan_day" }, status: "failed", error_message: "missing_plan_day" });
                await saveAssistantMessage(assistantText, { kind: "restart_failed" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const { data: exIds } = await supabase
                .from("workout_exercises")
                .select("id")
                .eq("session_id", activeSession.id);
              const ids = ((exIds as Array<{ id: string }> | null | undefined) ?? []).map((r) => r.id);
              if (ids.length) {
                await supabase.from("workout_sets").delete().in("exercise_id", ids);
              }
              await supabase.from("workout_exercises").delete().eq("session_id", activeSession.id);

              const { data: planEx } = await supabase
                .from("workout_plan_day_exercises")
                .select("exercise_name, muscle_group, target_sets, target_reps_min, target_reps_max, target_rpe, display_order, cues")
                .eq("plan_day_id", todayDay.id)
                .order("display_order", { ascending: true });
              type PlanExRow = {
                exercise_name: string | null;
                muscle_group: string | null;
                target_sets: number | null;
                target_reps_min: number | null;
                target_reps_max: number | null;
                target_rpe: number | null;
                display_order: number | null;
                cues: string | null;
              };

              const exRows = ((planEx as PlanExRow[] | null | undefined) ?? []).map((e, idx) => {
                const notes = JSON.stringify({
                  target_sets: typeof e.target_sets === "number" ? e.target_sets : 3,
                  target_reps_min: typeof e.target_reps_min === "number" ? e.target_reps_min : 8,
                  target_reps_max: typeof e.target_reps_max === "number" ? e.target_reps_max : typeof e.target_reps_min === "number" ? e.target_reps_min : 12,
                  target_rpe: typeof e.target_rpe === "number" ? e.target_rpe : null,
                  cues: typeof e.cues === "string" ? e.cues : ""
                });
                return {
                  id: crypto.randomUUID(),
                  session_id: activeSession.id,
                  exercise_order: typeof e.display_order === "number" ? e.display_order : idx + 1,
                  muscle_group: typeof e.muscle_group === "string" ? e.muscle_group : null,
                  exercise_name: typeof e.exercise_name === "string" ? e.exercise_name : `Exercise ${idx + 1}`,
                  notes
                };
              });
              if (exRows.length) {
                const exIns = await supabase.from("workout_exercises").insert(exRows);
                if (exIns.error) throw new Error(`Failed to recreate exercises: ${exIns.error.message}`);
              }

              await supabase
                .from("workout_sessions")
                .update({ title: todayDay.title, session_type: todayDay.session_type, started_at: new Date().toISOString(), status: "in_progress" })
                .eq("id", activeSession.id)
                .eq("user_id", userId);

              await logToolExecution({ tool_name: "restart_today", input: { intent: "restart_today", sessionId: activeSession.id }, output: { status: "ok" } });

              const progress = await getSessionProgress(activeSession.id);
              const active = progress.activeExercise;
              const meta = safeJson<{ target_sets?: number; target_reps_min?: number; target_reps_max?: number; cues?: string }>(active?.notes);
              const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
              const rMin = typeof meta?.target_reps_min === "number" ? meta.target_reps_min : null;
              const rMax = typeof meta?.target_reps_max === "number" ? meta.target_reps_max : rMin;
              const reps = rMin ? (rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`) : null;
              const targetText = targetSets && reps ? `${targetSets}x${reps}` : null;
              const cues = typeof meta?.cues === "string" && meta.cues.trim() ? meta.cues.trim() : null;
              const completedSets = progress.doneFlags?.find((d) => d.id === active?.id)?.completed ?? 0;

              const assistantText = buildWorkoutSessionText({
                sessionTitle: todayDay.title,
                exerciseName: active?.exercise_name || "Exercise",
                targetText,
                cues,
                exerciseIndex: progress.activeIndex,
                exerciseTotal: progress.exercises.length,
                completedSets,
                targetSets,
                headerLine: "Restarted"
              });

              await saveAssistantMessage(assistantText, { kind: "workout_session" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "next_exercise" || intent.kind === "finish_exercise") {
              if (!activeSession?.id) {
                const assistantText = "No active workout session. Type start to begin today’s workout.";
                await logToolExecution({ tool_name: intent.kind, input: { intent: intent.kind }, output: { status: "no_active_session" } });
                await saveAssistantMessage(assistantText, { kind: "no_active_session" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const progress = await getSessionProgress(activeSession.id);
              const active = progress.activeExercise;
              if (active?.id) {
                const meta = safeJson<Record<string, unknown>>(active.notes) || {};
                meta.force_completed = true;
                await supabase.from("workout_exercises").update({ notes: JSON.stringify(meta) }).eq("id", active.id);
              }

              const updated = await getSessionProgress(activeSession.id);
              const next = updated.activeExercise;
              const meta = safeJson<{ target_sets?: number; target_reps_min?: number; target_reps_max?: number; cues?: string }>(next?.notes);
              const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
              const rMin = typeof meta?.target_reps_min === "number" ? meta.target_reps_min : null;
              const rMax = typeof meta?.target_reps_max === "number" ? meta.target_reps_max : rMin;
              const reps = rMin ? (rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`) : null;
              const targetText = targetSets && reps ? `${targetSets}x${reps}` : null;
              const cues = typeof meta?.cues === "string" && meta.cues.trim() ? meta.cues.trim() : null;
              const completedSets = updated.doneFlags?.find((d) => d.id === next?.id)?.completed ?? 0;

              const assistantText = buildWorkoutSessionText({
                sessionTitle: activeSession.title || "Session",
                exerciseName: next?.exercise_name || "Exercise",
                targetText,
                cues,
                exerciseIndex: updated.activeIndex,
                exerciseTotal: updated.exercises.length,
                completedSets,
                targetSets,
                headerLine: intent.kind === "finish_exercise" ? "Finished exercise" : "Next exercise"
              });
              await logToolExecution({ tool_name: intent.kind, input: { intent: intent.kind, sessionId: activeSession.id }, output: { status: "ok" } });
              await saveAssistantMessage(assistantText, { kind: "workout_session" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "end_session") {
              if (!activeSession?.id) {
                const assistantText = "No active workout session. Type start to begin today’s workout.";
                await logToolExecution({ tool_name: "end_session", input: { intent: "end_session" }, output: { status: "no_active_session" } });
                await saveAssistantMessage(assistantText, { kind: "no_active_session" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }
              const clientForEnd = await supabaseServer();
              const upd = await clientForEnd
                .from("workout_sessions")
                .update({ status: "completed", ended_at: new Date().toISOString() })
                .eq("id", activeSession.id)
                .eq("user_id", userId);
              if (upd.error) {
                throw new Error(`Failed to complete session: ${upd.error.message}`);
              }
              await logToolExecution({ tool_name: "end_session", input: { intent: "end_session", sessionId: activeSession.id }, output: { status: "ok" } });
              const assistantText = "Workout Session\nSession: Completed\nProgress: Great work. Type report today to review.";
              await saveAssistantMessage(assistantText, { kind: "workout_session_completed" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "set_log") {
              if (!activeSession?.id) {
                const assistantText = "No active workout session. Type start to begin today’s workout, or plan today to preview.";
                await logToolExecution({ tool_name: "log_set", input: { intent: "set_log" }, output: { status: "no_active_session" } });
                await saveAssistantMessage(assistantText, { kind: "no_active_session" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const progress = await getSessionProgress(activeSession.id);
              const active = progress.activeExercise;
              if (!active?.id) {
                const assistantText = "No exercises found in the active session.";
                await logToolExecution({ tool_name: "log_set", input: { intent: "set_log", sessionId: activeSession.id }, output: { status: "no_exercises" } });
                await saveAssistantMessage(assistantText, { kind: "no_exercises" });
                send({ type: "assistant", content: assistantText });
                controller.close();
                return;
              }

              const { data: lastSet } = await supabase
                .from("workout_sets")
                .select("set_order")
                .eq("exercise_id", active.id)
                .order("set_order", { ascending: false })
                .limit(1)
                .maybeSingle();
              let nextOrder = typeof lastSet?.set_order === "number" ? lastSet.set_order + 1 : 1;

              type WorkoutSetInsert = {
                id: string;
                exercise_id: string;
                set_order: number;
                weight_kg: number | null;
                reps: number;
                notes: string | null;
              };

              const inserts: WorkoutSetInsert[] = [];
              for (const s of intent.sets) {
                for (let i = 0; i < s.repeat; i++) {
                  inserts.push({
                    id: crypto.randomUUID(),
                    exercise_id: active.id,
                    set_order: nextOrder++,
                    weight_kg: s.weightKg,
                    reps: s.reps,
                    notes: s.isBodyweight ? "bodyweight" : null
                  });
                }
              }

              const clientForSets = await supabaseServer();
              let ins = await clientForSets.from("workout_sets").insert(inserts);
              if (ins.error) {
                const ins2 = await supabase.from("workout_sets").insert(inserts);
                if (ins2.error) throw new Error(`Failed to save sets: ${ins2.error.message}`);
                ins = ins2;
              }

              await logToolExecution({
                tool_name: "log_set",
                input: { intent: "set_log", sessionId: activeSession.id, exerciseId: active.id, sets: intent.sets },
                output: { status: "ok", inserted: inserts.length }
              });

              const updated = await getSessionProgress(activeSession.id);
              const current = updated.activeExercise;
              const prevMeta = safeJson<{ target_sets?: number; target_reps_min?: number; target_reps_max?: number; cues?: string }>(active.notes);
              const targetSets = typeof prevMeta?.target_sets === "number" ? prevMeta.target_sets : null;
              const rMin = typeof prevMeta?.target_reps_min === "number" ? prevMeta.target_reps_min : null;
              const rMax = typeof prevMeta?.target_reps_max === "number" ? prevMeta.target_reps_max : rMin;
              const reps = rMin ? (rMax && rMax !== rMin ? `${rMin}-${rMax}` : `${rMin}`) : null;
              const targetText = targetSets && reps ? `${targetSets}x${reps}` : null;
              const cues = typeof prevMeta?.cues === "string" && prevMeta.cues.trim() ? prevMeta.cues.trim() : null;
              const completedSets = updated.doneFlags?.find((d) => d.id === active.id)?.completed ?? 0;

              const movedToNext = Boolean(current?.id && current.id !== active.id);
              const done =
                typeof targetSets === "number" ? completedSets >= targetSets : false;
              const savedLine = movedToNext && done
                ? `Done: ${active.exercise_name || "exercise"} ${completedSets}/${targetSets}. Next: ${current?.exercise_name || "next exercise"}?`
                : `Saved: ${inserts.length} set${inserts.length === 1 ? "" : "s"} for ${active.exercise_name || "exercise"}.`;
              const assistantText = buildWorkoutSessionText({
                sessionTitle: activeSession.title || "Session",
                exerciseName: current?.exercise_name || active.exercise_name || "Exercise",
                targetText,
                cues,
                exerciseIndex: updated.activeIndex,
                exerciseTotal: updated.exercises.length,
                completedSets,
                targetSets,
                headerLine: savedLine
              });
              await saveAssistantMessage(assistantText, { kind: "workout_session" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind === "plan_today" || intent.kind === "plan_this_week") {
              const plan = await ensureActivePlan();
              const assistantText = await buildPlanText({
                planId: plan.id,
                scope: intent.kind === "plan_today" ? "today" : "week",
                inProgress: Boolean(activeSession?.id)
              });
              await logToolExecution({ tool_name: "show_plan", input: { intent: intent.kind, planId: plan.id }, output: { status: "ok" } });
              await saveAssistantMessage(assistantText, { kind: "workout_plan" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (intent.kind.startsWith("report_")) {
              const range =
                intent.kind === "report_today"
                  ? "today"
                  : intent.kind === "report_last_week"
                    ? "last_week"
                    : intent.kind === "report_last_month"
                      ? "last_month"
                      : "last_year";
              const assistantText = await handleReport(range);
              await logToolExecution({ tool_name: "report", input: { intent: intent.kind, range }, output: { status: "ok" } });
              await saveAssistantMessage(assistantText, { kind: "report", range });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }

            if (
              intent.kind === "body_metrics" ||
              intent.kind === "weight_trend" ||
              intent.kind === "body_fat_trend" ||
              intent.kind === "waist_trend"
            ) {
              const metric =
                intent.kind === "body_fat_trend"
                  ? "body_fat_pct"
                  : intent.kind === "waist_trend"
                    ? "waist_cm"
                    : "weight_kg";
              const assistantText = ["Body Metrics Report", `Metric: ${metric}`, "Range: 30d"].join("\n");
              await logToolExecution({ tool_name: "body_metrics", input: { intent: intent.kind, metric }, output: { status: "ok" } });
              await saveAssistantMessage(assistantText, { kind: "body_metrics_report", metric, range: "30d" });
              send({ type: "assistant", content: assistantText });
              controller.close();
              return;
            }
          }

          const bodyReportIntent = userText ? parseBodyMetricsReportIntent(userText) : null;
          if (bodyReportIntent) {
            const now = new Date();
            const start = new Date(now);
            if (bodyReportIntent.range === "7d") start.setDate(start.getDate() - 7);
            if (bodyReportIntent.range === "30d") start.setDate(start.getDate() - 30);
            if (bodyReportIntent.range === "1y") start.setDate(start.getDate() - 365);

            const metricCol = bodyReportIntent.metric;
            const { data, error } = await supabase
              .from("body_metrics")
              .select(`measured_at, ${metricCol}`)
              .eq("user_id", userId)
              .gte("measured_at", start.toISOString())
              .order("measured_at", { ascending: true })
              .limit(500);

            if (error) throw new Error(`Failed to load body metrics: ${error.message}`);

            const points =
              (data as Array<Record<string, unknown>> | null | undefined)
                ?.map((row) => {
                  const measuredAt = typeof row.measured_at === "string" ? row.measured_at : "";
                  const v = row[metricCol];
                  const value = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
                  if (!measuredAt || !Number.isFinite(value)) return null;
                  return { measuredAt, value };
                })
                .filter(Boolean) as Array<{ measuredAt: string; value: number }> | undefined;

            const values = points?.map((p) => p.value) ?? [];
            const latest = points?.[points.length - 1];
            const first = points?.[0];

            const min = values.length ? Math.min(...values) : null;
            const max = values.length ? Math.max(...values) : null;
            const delta = latest && first ? latest.value - first.value : null;

            const unit = metricCol === "weight_kg" ? "kg" : metricCol === "body_fat_pct" ? "%" : "cm";
            const deltaText =
              typeof delta === "number"
                ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}${unit}`
                : "—";

            const assistantText = [
              "Body Metrics Report",
              `Metric: ${metricCol}`,
              `Range: ${bodyReportIntent.range}`,
              values.length
                ? `Latest: ${metricLabel(metricCol)} ${latest?.value.toFixed(1)}${unit} (${deltaText} vs start)`
                : "Not enough data yet. Log a few measurements first.",
              values.length && typeof min === "number" && typeof max === "number"
                ? `Min/Max: ${min.toFixed(1)}${unit} / ${max.toFixed(1)}${unit}`
                : ""
            ]
              .filter(Boolean)
              .join("\n");

            {
              const id = crypto.randomUUID();
              const ins = await supabase.from("chat_messages").insert({
                id,
                thread_id: threadId,
                user_id: userId,
                role: "assistant",
                content: assistantText,
                metadata: { kind: "body_metrics_report", metric: metricCol, range: bodyReportIntent.range }
              });
              if (ins.error) throw new Error(`Failed to save assistant message: ${ins.error.message}`);
            }

            send({ type: "assistant", content: assistantText });
            controller.close();
            return;
          }

          const context = await loadUserContext({ supabase, userId });

          const { data: historyData } = await supabase
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

          const asksWeekPlan =
            (lower.includes("this week") || lower.includes("tuần này")) &&
            (lower.includes("plan") ||
              lower.includes("split") ||
              lower.includes("program") ||
              lower.includes("routine") ||
              lower.includes("kế hoạch") ||
              lower.includes("lịch tập"));

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
- format the response like a single-day plan with an explicit day header: "Day 1: Today - <Session Name>"
- include a "Target:" line, then a bullet list of exercises with "sets x reps", and short cues

DO NOT:
- summarize last week
- repeat profile info
- talk about stored profile unless necessary

Just give today's plan.
`
            });
          }

          if (asksWeekPlan && !asksHistory) {
            messages.push({
              role: "system",
              content: `
The user is asking for a plan for this week.

You MUST format the output as a multi-day plan:
- Start each day with: "Day 1: <Session Name>", "Day 2: ...", etc.
- Immediately under each day include: "Target: <main muscle group>"
- Then list exercises as bullets using the format: "<Exercise> — 4x8-10" (use x notation)
- Add a short "Cues:" line (1-3 short tips) per day, not long paragraphs

Keep it clean and easy to scan.
`
            });
          }

          if (asksHistory) {
            const today = new Date().toISOString().slice(0, 10);
            messages.push({
              role: "system",
              content: `
The user is asking about workout history.

Today is ${today}.

Interpret time ranges like this:
- "last week" = recent sessions around 2026-03-12 to 2026-03-18
- "this week" = sessions around 2026-03-17 to 2026-03-19
- "last month" = recent sessions from the previous few weeks

If workout history context contains sessions in those dates, summarize them directly.
Do NOT say "I don't have enough workout data" if workout history context is present.
Do NOT switch to today's plan unless the user asks for a plan.

Format the answer as a structured report with these headings:
- Weekly Report / Monthly Report (choose based on the user request)
- Training Summary:
- Muscle Groups Trained (include counts like "Chest: 2x"):
- Strongest Area:
- Weak Points:
- Progression Highlights:
- Score:
- Next Steps:

Do NOT output any workout plan. Do NOT use day-by-day programming (no "Day 1", "Day 2").
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
                  const ins = await supabase.from("chat_messages").insert({
                    id,
                    thread_id: threadId,
                    user_id: userId,
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
              const ins = await supabase.from("chat_messages").insert({
                id,
                thread_id: threadId,
                user_id: userId,
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
