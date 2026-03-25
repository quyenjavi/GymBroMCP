"use client";

import { useEffect, useRef } from "react";

import type { ChatMessage } from "../lib/types";
import MessageBubble from "./MessageBubble";

export default function ChatWindow({
  messages,
  isLoading
}: {
  messages: ChatMessage[];
  isLoading: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto w-full max-w-3xl px-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="text-base font-semibold tracking-tight text-zinc-100">Ready to start</div>
              <div className="mt-2 text-sm text-zinc-400">
                Type start, plan today, report last week, or log sets like 40x10x3.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-zinc-950/50 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-800">
                  start
                </span>
                <span className="rounded-full bg-zinc-950/50 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-800">
                  plan today
                </span>
                <span className="rounded-full bg-zinc-950/50 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-800">
                  report last week
                </span>
                <span className="rounded-full bg-zinc-950/50 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-800">
                  body metrics
                </span>
              </div>
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {isLoading ? (
          <div className="mx-auto w-full max-w-3xl px-4">
            <div className="flex justify-start">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-400">
                Gym Bro is typing...
              </div>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
