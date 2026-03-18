"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabaseBrowser } from "../../../lib/supabase/browser";

export default function LoginForm() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setError(null);
    setStatus("loading");

    try {
      const supabase = supabaseBrowser();
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password
        });
        if (signUpError) throw signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) throw signInError;
      }

      router.push("/chat");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm text-zinc-300">Email</label>
        <input
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-zinc-600"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm text-zinc-300">Password</label>
        <input
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          type="password"
          required
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-zinc-600"
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
      >
        {status === "loading" ? "Working..." : mode === "signup" ? "Create account" : "Login"}
      </button>

      <button
        type="button"
        onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
        className="w-full text-sm text-zinc-400 hover:text-zinc-200"
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}
      </button>
    </form>
  );
}
