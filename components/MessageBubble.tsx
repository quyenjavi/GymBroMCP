"use client";

import type { ChatMessage } from "../lib/types";

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";

  if (isTool || isSystem) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
          {isSystem ? "System" : message.tool_name ? `Tool: ${message.tool_name}` : "Tool message"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <div className={isUser ? "flex justify-end" : "flex justify-start"}>
        <div
          className={
            isUser
              ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-950"
              : "max-w-[85%] whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-100"
          }
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
