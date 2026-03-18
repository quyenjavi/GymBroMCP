"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import ChatInput from "../../../components/ChatInput";
import ChatWindow from "../../../components/ChatWindow";
import type { ChatMessage } from "../../../lib/types";
import { supabaseBrowser } from "../../../lib/supabase/browser";

type StreamEvent =
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "assistant"; content: string }
  | { type: "error"; message: string };

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

  async function onLogout() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function onSend() {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    setMessages((prev: ChatMessage[]) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, message: text })
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
              setMessages((prev: ChatMessage[]) => [
                ...prev,
                { id: newId(), role: "assistant", content: evt.content }
              ]);
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
    }
  }

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
            <div className="mx-auto w-full max-w-3xl px-4 py-2 text-xs text-zinc-400">🔍 Searching...</div>
          </div>
        ) : null}
        <ChatInput value={input} onChange={setInput} onSend={onSend} disabled={isLoading} />
      </div>
    </div>
  );
}
