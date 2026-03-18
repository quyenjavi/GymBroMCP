import type { SupabaseClient } from "@supabase/supabase-js";

type UserProfileRow = {
  display_name: string | null;
  gender: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  fitness_goal: string | null;
  fitness_level: string | null;
  preferred_split: string | null;
  training_days_per_week: number | null;
  notes: string | null;
};

type UserMemoryRow = {
  memory_key: string | null;
  memory_value: string | null;
  importance: number | null;
  updated_at: string | null;
};

type WorkoutSessionRow = {
  id: string;
  session_date: string | null;
  workout_type: string | null;
  title: string | null;
  notes: string | null;
  perceived_score: number | null;
};

type WorkoutExerciseRow = {
  id: string;
  session_id: string;
  exercise_order: number | null;
  muscle_group: string | null;
  exercise_name: string | null;
  notes: string | null;
};

type WorkoutSetRow = {
  exercise_id: string;
  set_order: number | null;
  weight_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  notes: string | null;
};

export async function loadUserContext({
  supabase,
  userId
}: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const profileRes = await supabase
    .from("user_profiles")
    .select(
      "display_name, gender, age, height_cm, weight_kg, fitness_goal, fitness_level, preferred_split, training_days_per_week, notes"
    )
    .eq("id", userId)
    .maybeSingle<UserProfileRow>();

  const p = profileRes.data;
const profileText = p
  ? [
      p.display_name ? `User name is ${p.display_name}` : null,
      p.gender ? `Gender is ${p.gender}` : null,
      typeof p.age === "number" ? `Age is ${p.age}` : null,
      typeof p.height_cm === "number" ? `Height is ${p.height_cm} cm` : null,
      typeof p.weight_kg === "number" ? `Weight is ${p.weight_kg} kg` : null,
      p.fitness_goal ? `Goal is ${p.fitness_goal}` : null,
      p.fitness_level ? `Fitness level is ${p.fitness_level}` : null,
      p.preferred_split ? `Preferred split is ${p.preferred_split}` : null,
      typeof p.training_days_per_week === "number"
        ? `Training frequency is ${p.training_days_per_week} days per week`
        : null,
      p.notes ? `Notes: ${p.notes}` : null
    ]
      .filter((x): x is string => Boolean(x))
      .join(". ")
  : "";

  const memoriesRes = await supabase
    .from("user_memories")
    .select("memory_key, memory_value, importance, updated_at")
    .eq("user_id", userId)
    .order("importance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(20)
    .returns<UserMemoryRow[]>();

  const memoriesText = Array.isArray(memoriesRes.data)
    ? memoriesRes.data
        .map((m) => {
          if (!m.memory_key && !m.memory_value) return null;
          const imp = typeof m.importance === "number" ? ` (imp ${m.importance})` : "";
          return `- ${m.memory_key || "memory"}: ${m.memory_value || ""}${imp}`.trim();
        })
        .filter((x): x is string => Boolean(x))
        .join("\n")
    : "";

  const sessionsRes = await supabase
    .from("workout_sessions")
    .select("id, session_date, workout_type, title, notes, perceived_score")
    .eq("user_id", userId)
    .order("session_date", { ascending: false })
    .limit(6)
    .returns<WorkoutSessionRow[]>();

  const sessions = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
  const sessionIds = sessions.map((s) => s.id);

  const exercisesRes =
    sessionIds.length > 0
      ? await supabase
          .from("workout_exercises")
          .select("id, session_id, exercise_order, muscle_group, exercise_name, notes")
          .in("session_id", sessionIds)
          .order("exercise_order", { ascending: true })
          .returns<WorkoutExerciseRow[]>()
      : null;

  const exercises = Array.isArray(exercisesRes?.data) ? exercisesRes!.data : [];
  const exerciseIds = exercises.map((e) => e.id);

  const setsRes =
    exerciseIds.length > 0
      ? await supabase
          .from("workout_sets")
          .select("exercise_id, set_order, weight_kg, reps, duration_sec, distance_m, notes")
          .in("exercise_id", exerciseIds)
          .order("set_order", { ascending: true })
          .returns<WorkoutSetRow[]>()
      : null;

  const sets = Array.isArray(setsRes?.data) ? setsRes!.data : [];

  const setsByExercise = new Map<string, WorkoutSetRow[]>();
  for (const s of sets) {
    const arr = setsByExercise.get(s.exercise_id) || [];
    arr.push(s);
    setsByExercise.set(s.exercise_id, arr);
  }

  const exercisesBySession = new Map<string, WorkoutExerciseRow[]>();
  for (const e of exercises) {
    const arr = exercisesBySession.get(e.session_id) || [];
    arr.push(e);
    exercisesBySession.set(e.session_id, arr);
  }

  const recentWorkoutsText = sessions
    .map((s) => {
      const headerParts = [
        s.session_date ? s.session_date : null,
        s.title ? s.title : null,
        s.workout_type ? `(${s.workout_type})` : null,
        typeof s.perceived_score === "number" ? `score ${s.perceived_score}` : null
      ].filter((x): x is string => Boolean(x));

      const lines: string[] = [`- ${headerParts.join(" ")}`.trim()];

      const sessionExercises = exercisesBySession.get(s.id) || [];
      for (const ex of sessionExercises) {
        const name = ex.exercise_name || "Exercise";
        const mg = ex.muscle_group ? ` [${ex.muscle_group}]` : "";
        const setStrings = (setsByExercise.get(ex.id) || []).map((set) => {
          const w = typeof set.weight_kg === "number" ? `${set.weight_kg}` : "";
          const r = typeof set.reps === "number" ? `${set.reps}` : "";
          if (w && r) return `${w}x${r}`;
          if (r && typeof set.duration_sec === "number") return `${r} reps @${set.duration_sec}s`;
          if (typeof set.distance_m === "number") return `${set.distance_m}m`;
          return "set";
        });

        const setsLine = setStrings.length ? ` — ${setStrings.join(", ")}` : "";
        lines.push(`  - ${name}${mg}${setsLine}`.trimEnd());
      }

      if (s.notes) lines.push(`  - notes: ${s.notes}`);
      return lines.join("\n");
    })
    .join("\n");

  return { profileText, memoriesText, recentWorkoutsText };
}
