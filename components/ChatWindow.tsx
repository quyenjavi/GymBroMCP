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
