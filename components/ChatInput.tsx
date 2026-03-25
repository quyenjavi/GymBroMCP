"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export type ChatActionChip = {
  label: string;
  command: string;
  variant?: "primary" | "secondary" | "danger";
};

export default function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  attachedImage,
  onPickImage,
  onRemoveImage,
  placeholder,
  actions,
  onAction,
  contextBar
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  attachedImage: { dataUrl: string; name: string } | null;
  onPickImage: (file: File) => void;
  onRemoveImage: () => void;
  placeholder: string;
  actions: ChatActionChip[];
  onAction: (command: string) => void;
  contextBar: {
    modeLabel: string;
    sessionTitle?: string | null;
    exerciseName?: string | null;
    exerciseProgress?: string | null;
    setProgress?: string | null;
  } | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="border-t border-zinc-900 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        {contextBar ? (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-950">
                {contextBar.modeLabel}
              </span>
              {contextBar.sessionTitle ? (
                <span className="rounded-full bg-zinc-950/50 px-2.5 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-800">
                  {contextBar.sessionTitle}
                </span>
              ) : null}
              {contextBar.exerciseName ? (
                <span className="rounded-full bg-zinc-950/50 px-2.5 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-800">
                  {contextBar.exerciseName}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              {contextBar.exerciseProgress ? <span>{contextBar.exerciseProgress}</span> : null}
              {contextBar.setProgress ? <span>{contextBar.setProgress}</span> : null}
            </div>
          </div>
        ) : null}

        {attachedImage ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <Image
                src={attachedImage.dataUrl}
                alt={attachedImage.name}
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 shrink-0 rounded-lg border border-zinc-800 object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-zinc-100">{attachedImage.name}</div>
                <div className="text-[11px] text-zinc-500">Image attached</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onRemoveImage}
              className="shrink-0 rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-600"
              disabled={disabled}
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              onPickImage(file);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-600 disabled:opacity-60"
          >
            Image
          </button>
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
            placeholder={placeholder}
            className="max-h-[180px] w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-60"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || (!value.trim() && !attachedImage)}
            className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
          >
            Send
          </button>
        </div>

        {actions.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((a) => {
              const base =
                a.variant === "primary"
                  ? "bg-zinc-100 text-zinc-950"
                  : a.variant === "danger"
                    ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25"
                    : "bg-zinc-950/50 text-zinc-200 ring-1 ring-zinc-800";
              return (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => onAction(a.command)}
                  disabled={disabled}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${base} disabled:opacity-60`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
