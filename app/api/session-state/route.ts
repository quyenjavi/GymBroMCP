import { NextResponse } from "next/server";

import { supabaseAdmin } from "../../../lib/supabase/admin";
import { supabaseServer } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function safeJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function startOfTodayUtcIso() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return start.toISOString();
}

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  const today = new Date().toISOString().slice(0, 10);
  const { data: session } = await admin
    .from("workout_sessions")
    .select("id, title, status, session_date")
    .eq("user_id", user.id)
    .eq("session_date", today)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session?.id) {
    return NextResponse.json({ mode: "idle", session: null, exercise: null });
  }

  const { data: exercisesData, error: exErr } = await admin
    .from("workout_exercises")
    .select("id, exercise_name, exercise_order, notes")
    .eq("session_id", session.id)
    .order("exercise_order", { ascending: true });

  if (exErr) {
    return NextResponse.json({ mode: "idle", session: null, exercise: null });
  }

  const exercises = (exercisesData as Array<{ id: string; exercise_name: string | null; exercise_order: number | null; notes: string | null }> | null | undefined) ?? [];
  if (exercises.length === 0) {
    return NextResponse.json({
      mode: "workout_in_progress",
      session: { id: session.id, title: session.title ?? null, status: session.status ?? null },
      exercise: null
    });
  }

  const { data: setsData } = await admin
    .from("workout_sets")
    .select("exercise_id, is_warmup")
    .in(
      "exercise_id",
      exercises.map((e) => e.id)
    )
    .gte("created_at", startOfTodayUtcIso())
    .limit(2000);

  const setCounts = new Map<string, number>();
  for (const s of (setsData as Array<{ exercise_id: string; is_warmup: boolean | null }> | null | undefined) ?? []) {
    if (s.is_warmup) continue;
    setCounts.set(s.exercise_id, (setCounts.get(s.exercise_id) || 0) + 1);
  }

  const targets = exercises.map((e) => {
    const meta = safeJson<{ target_sets?: unknown; force_completed?: unknown }>(e.notes);
    const targetSets = typeof meta?.target_sets === "number" ? meta.target_sets : null;
    const forceCompleted = meta?.force_completed === true;
    const completedSets = setCounts.get(e.id) || 0;
    const done = forceCompleted || (typeof targetSets === "number" ? completedSets >= targetSets : false);
    return { id: e.id, targetSets, completedSets, done };
  });

  let activeIndex = targets.findIndex((t) => !t.done);
  if (activeIndex === -1) activeIndex = targets.length - 1;

  const active = exercises[activeIndex];
  const activeTarget = targets[activeIndex];

  return NextResponse.json({
    mode: "workout_in_progress",
    session: { id: session.id, title: session.title ?? null, status: session.status ?? null },
    exercise: {
      id: active.id,
      name: active.exercise_name ?? null,
      index: activeIndex,
      total: exercises.length,
      targetSets: activeTarget.targetSets,
      completedSets: activeTarget.completedSets
    }
  });
}

