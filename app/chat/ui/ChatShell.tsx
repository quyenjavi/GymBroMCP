"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ChatInput, { type ChatActionChip } from "../../../components/ChatInput";
import ChatWindow from "../../../components/ChatWindow";
import type { ChatMessage, StreamEvent } from "../../../lib/types";
import { supabaseBrowser } from "../../../lib/supabase/browser";

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ChatShell({
  threadId,
  userEmail,
  initialMessages
}: {
  threadId: string;
  userEmail: string;
  initialMessages: ChatMessage[];
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; name: string } | null>(
    null
  );
  const [suppressContext, setSuppressContext] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<null | { type: "resume_or_restart" }>(null);
  const [sessionState, setSessionState] = useState<null | {
    mode: "idle" | "workout_in_progress";
    session?: { id: string; title: string | null; status: string | null } | null;
    exercise?: {
      id: string;
      name: string | null;
      index: number;
      total: number;
      targetSets: number | null;
      completedSets: number;
    } | null;
  }>(null);

  async function onLogout() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const refreshSessionState = useCallback(async () => {
    if (suppressContext) return;
    const res = await fetch("/api/session-state", { method: "GET" });
    if (!res.ok) return;
    const json = (await res.json()) as unknown;
    const obj = (json ?? {}) as Record<string, unknown>;
    const mode = obj.mode === "workout_in_progress" ? "workout_in_progress" : "idle";
    const session =
      obj.session && typeof obj.session === "object" ? (obj.session as Record<string, unknown>) : null;
    const exercise =
      obj.exercise && typeof obj.exercise === "object" ? (obj.exercise as Record<string, unknown>) : null;
    setSessionState({
      mode,
      session: session
        ? {
            id: String(session.id ?? ""),
            title: typeof session.title === "string" ? session.title : null,
            status: typeof session.status === "string" ? session.status : null
          }
        : null,
      exercise: exercise
        ? {
            id: String(exercise.id ?? ""),
            name: typeof exercise.name === "string" ? exercise.name : null,
            index: typeof exercise.index === "number" ? exercise.index : Number(exercise.index) || 0,
            total: typeof exercise.total === "number" ? exercise.total : Number(exercise.total) || 0,
            targetSets: typeof exercise.targetSets === "number" ? exercise.targetSets : null,
            completedSets:
              typeof exercise.completedSets === "number"
                ? exercise.completedSets
                : Number(exercise.completedSets) || 0
          }
        : null
    });
  }, [suppressContext]);

  useEffect(() => {
    void refreshSessionState();
  }, [refreshSessionState]);

  async function onPickImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 6 * 1024 * 1024) {
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        { id: newId(), role: "assistant", content: "Image too large. Please use an image under 6MB." }
      ]);
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    if (!dataUrl.startsWith("data:image/")) return;
    setAttachedImage({ dataUrl, name: file.name || "image" });
  }

  function normalizeCommand(text: string) {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function isClearOrReset(text: string) {
    const t = normalizeCommand(text);
    return (
      t === "clear" ||
      t === "reset" ||
      t === "/reset" ||
      t === "clear chat" ||
      t === "reset chat"
    );
  }

  async function sendToChatApi({
    text,
    imageDataUrl
  }: {
    text: string;
    imageDataUrl: string | null;
  }) {
    setIsLoading(true);
    setPendingConfirm(null);

    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    setMessages((prev: ChatMessage[]) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: text, imageDataUrl })
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let lineBreakIndex = buf.indexOf("\n");
        while (lineBreakIndex !== -1) {
          const line = buf.slice(0, lineBreakIndex).trim();
          buf = buf.slice(lineBreakIndex + 1);
          if (line) {
            const evt = JSON.parse(line) as StreamEvent;
            if (evt.type === "tool_start") setIsSearching(true);
            if (evt.type === "tool_end") setIsSearching(false);
            if (evt.type === "assistant") {
              const content = evt.content;
              if (content.includes("CONFIRM_RESUME_OR_RESTART")) {
                setPendingConfirm({ type: "resume_or_restart" });
              }
              setMessages((prev: ChatMessage[]) => [...prev, { id: newId(), role: "assistant", content }]);
            }
            if (evt.type === "error") {
              setMessages((prev: ChatMessage[]) => [
                ...prev,
                { id: newId(), role: "assistant", content: `Error: ${evt.message}` }
              ]);
            }
          }
          lineBreakIndex = buf.indexOf("\n");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        { id: newId(), role: "assistant", content: `Error: ${message}` }
      ]);
    } finally {
      setIsLoading(false);
      setIsSearching(false);
      router.refresh();
      void refreshSessionState();
    }
  }

  async function onSend() {
    const text = input.trim();
    if ((!text && !attachedImage) || isLoading) return;

    if (isClearOrReset(text) && !attachedImage) {
      setInput("");
      setAttachedImage(null);
      setIsSearching(false);
      setPendingConfirm(null);
      setSessionState(null);
      setSuppressContext(true);
      setMessages([]);
      return;
    }

    setSuppressContext(false);
    setInput("");
    const imageDataUrl = attachedImage?.dataUrl || null;
    const imageName = attachedImage?.name || null;
    setAttachedImage(null);

    const displayText = text || (imageName ? `Image: ${imageName}` : "Image uploaded");
    await sendToChatApi({ text: displayText, imageDataUrl });
  }

  const mode = sessionState?.mode ?? "idle";

  const placeholder = useMemo(() => {
    if (mode === "workout_in_progress") return "Log sets like 40x10x3, or type report today";
    return "Type start, plan today, report last week, or log sets like 40x10x3";
  }, [mode]);

  const actions = useMemo<ChatActionChip[]>(() => {
    if (pendingConfirm?.type === "resume_or_restart") {
      return [
        { label: "Resume", command: "/resume", variant: "primary" },
        { label: "Restart", command: "/restart_today", variant: "danger" },
        { label: "Reset", command: "reset", variant: "secondary" }
      ];
    }

    if (mode === "workout_in_progress") {
      return [
        { label: "Next Exercise", command: "/next", variant: "secondary" },
        { label: "Finish Exercise", command: "/finish_exercise", variant: "secondary" },
        { label: "Report Today", command: "report today", variant: "secondary" },
        { label: "End Session", command: "/end", variant: "danger" },
        { label: "Reset", command: "reset", variant: "secondary" }
      ];
    }

    return [
      { label: "Start", command: "start", variant: "primary" },
      { label: "Plan Today", command: "plan today", variant: "secondary" },
      { label: "Plan This Week", command: "plan this week", variant: "secondary" },
      { label: "Report Today", command: "report today", variant: "secondary" },
      { label: "Last Week", command: "report last week", variant: "secondary" },
      { label: "Body Metrics", command: "body metrics", variant: "secondary" },
      { label: "Clear", command: "clear", variant: "danger" }
    ];
  }, [mode, pendingConfirm]);

  const contextBar = useMemo(() => {
    if (suppressContext) return { modeLabel: "Idle" };
    if (mode !== "workout_in_progress" || !sessionState?.session) return { modeLabel: "Idle" };
    const ex = sessionState.exercise;
    const sessionTitle = sessionState.session.title || "Session";
    const exerciseName = ex?.name || null;
    const exerciseProgress = ex ? `Exercise ${Math.max(ex.index + 1, 1)}/${Math.max(ex.total, 1)}` : null;
    const setProgress =
      ex && typeof ex.targetSets === "number"
        ? `Set ${Math.min(ex.completedSets, ex.targetSets)}/${ex.targetSets}`
        : ex
          ? `Sets ${ex.completedSets}`
          : null;
    return {
      modeLabel: "Workout in progress",
      sessionTitle,
      exerciseName,
      exerciseProgress,
      setProgress
    };
  }, [mode, sessionState, suppressContext]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm font-semibold tracking-tight">Gym Bro</div>
            <div className="text-xs text-zinc-500">{userEmail}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-600"
          >
            Logout
          </button>
        </div>
      </header>

      <ChatWindow messages={messages} isLoading={isLoading} />

      <div className="sticky bottom-0">
        {isSearching ? (
          <div className="border-t border-zinc-900 bg-zinc-950/80 backdrop-blur">
            <div className="mx-auto w-full max-w-3xl px-4 py-2 text-xs text-zinc-400">Searching...</div>
          </div>
        ) : null}
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={onSend}
          disabled={isLoading}
          attachedImage={attachedImage}
          onPickImage={onPickImage}
          onRemoveImage={() => setAttachedImage(null)}
          placeholder={placeholder}
          actions={actions}
          onAction={(cmd) => {
            if (isClearOrReset(cmd)) {
              setInput("");
              setAttachedImage(null);
              setIsSearching(false);
              setPendingConfirm(null);
              setSessionState(null);
              setSuppressContext(true);
              setMessages([]);
              return;
            }
            setSuppressContext(false);
            void sendToChatApi({ text: cmd, imageDataUrl: null });
          }}
          contextBar={contextBar}
        />
      </div>
    </div>
  );
}
