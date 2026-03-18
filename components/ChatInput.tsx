"use client";

import { useEffect, useRef } from "react";

export default function ChatInput({
  value,
  onChange,
  onSend,
  disabled
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="border-t border-zinc-900 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Log your sets, ask for a plan..."
            className="max-h-[180px] w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-60"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

