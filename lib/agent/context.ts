import type { SupabaseClient } from "@supabase/supabase-js";

type UserProfileRow = {
  display_name: string | null;
  gender: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
};

type UserMemoryRow = {
  content: string | null;
  created_at: string | null;
};

type WorkoutSessionRow = {
  id: string;
  session_date: string | null;
  title: string | null;
};

type WorkoutExerciseRow = {
  id: string;
  session_id: string;
  exercise_name: string | null;
  muscle_group: string | null;
};

type WorkoutSetRow = {
  exercise_id: string;
  weight_kg: number | null;
  reps: number | null;
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
    .select("display_name, gender, age, height_cm, weight_kg")
    .eq("id", userId)
    .maybeSingle<UserProfileRow>();

  const p = profileRes.data;

  const profileText = p
    ? [
        p.display_name ? `User name is ${p.display_name}` : null,
        p.gender ? `Gender is ${p.gender}` : null,
        typeof p.age === "number" ? `Age is ${p.age}` : null,
        typeof p.height_cm === "number" ? `Height is ${p.height_cm} cm` : null,
        typeof p.weight_kg === "number" ? `Weight is ${p.weight_kg} kg` : null
      ]
        .filter((x): x is string => Boolean(x))
        .join(". ")
    : "";

  const memoriesRes = await supabase
    .from("user_memories")
    .select("content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<UserMemoryRow[]>();

  const memoriesText = Array.isArray(memoriesRes.data)
    ? memoriesRes.data
        .map((m) => m.content)
        .filter((x): x is string => Boolean(x))
        .join("\n")
    : "";

  const sessionsRes = await supabase
    .from("workout_sessions")
    .select("id, session_date, title")
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
          .select("id, session_id, exercise_name, muscle_group")
          .in("session_id", sessionIds)
          .returns<WorkoutExerciseRow[]>()
      : null;

  const exercises = Array.isArray(exercisesRes?.data) ? exercisesRes!.data : [];
  const exerciseIds = exercises.map((e) => e.id);

  const setsRes =
    exerciseIds.length > 0
      ? await supabase
          .from("workout_sets")
          .select("exercise_id, weight_kg, reps")
          .in("exercise_id", exerciseIds)
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

  const recentWorkoutsText =
    sessions.length > 0
    ? [
        "Recent workout history (latest sessions first):",
        ...sessions.map((s) => {
          const lines: string[] = [
            `Session: ${s.session_date || "Unknown date"} — ${s.title || "Workout"}`
          ];

          const sessionExercises = exercisesBySession.get(s.id) || [];
          for (const ex of sessionExercises) {
            const setStrings = (setsByExercise.get(ex.id) || []).map((set) => {
              const w = typeof set.weight_kg === "number" ? `${set.weight_kg}` : "";
              const r = typeof set.reps === "number" ? `${set.reps}` : "";
              if (w && r) return `${w}x${r}`;
              if (r) return `${r} reps`;
              return "set";
            });

            lines.push(
              `- ${ex.exercise_name || "Exercise"}${setStrings.length ? `: ${setStrings.join(", ")}` : ""}`
            );
          }

          return lines.join("\n");
        })
      ].join("\n\n")
    : "";

  return { profileText, memoriesText, recentWorkoutsText };
}
