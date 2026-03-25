"use client";

import { useEffect, useMemo, useState } from "react";

type MuscleFrequency = { muscle: string; count: number };

type PlanExercise = {
  name: string;
  setsReps?: string;
  cues: string[];
};

type PlanDay = {
  label: string;
  sessionName?: string;
  mainMuscle?: string;
  targetMuscles: string[];
  exercises: PlanExercise[];
  tips: string[];
};

type WorkoutPlan = {
  title?: string;
  days: PlanDay[];
  muscleFrequency: MuscleFrequency[];
};

type TrainingReport = {
  title?: string;
  period?: string;
  score?: string;
  trainingSummary: string[];
  muscleFrequency: MuscleFrequency[];
  strongestArea?: string;
  weakPoints: string[];
  progressionHighlights: string[];
  nextSteps: string[];
  evaluation?: string;
};

type BodyMetricKey = "weight_kg" | "body_fat_pct" | "waist_cm";

type BodyMetricsReport = {
  title?: string;
  rangeDays: number;
  metric: BodyMetricKey;
  summaryLines: string[];
  latest?: { date?: string; value?: number };
};

type WorkoutSessionCard = {
  headerLine?: string;
  sessionTitle?: string;
  exerciseName?: string;
  target?: string;
  cues: string[];
  progressText?: string;
};

type Structured =
  | { kind: "workout_plan"; plan: WorkoutPlan }
  | { kind: "report"; report: TrainingReport }
  | { kind: "body_metrics_report"; report: BodyMetricsReport }
  | { kind: "workout_session"; session: WorkoutSessionCard };

function stripInlineMarkdown(input: string) {
  return input
    .replace(/^\s*#{1,6}\s*/g, "")
    .replace(/^\s*[*_~`]+/g, "")
    .replace(/\s*[*_~`]+\s*$/g, "")
    .trim();
}

function titleCase(input: string) {
  return input
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeMuscleToken(raw: string) {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z\s/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const map: Record<string, string> = {
    chest: "Chest",
    pec: "Chest",
    pecs: "Chest",
    back: "Back",
    lats: "Back",
    "upper back": "Back",
    "mid back": "Back",
    legs: "Legs",
    quads: "Quads",
    hamstrings: "Hamstrings",
    hams: "Hamstrings",
    glutes: "Glutes",
    calves: "Calves",
    shoulders: "Shoulders",
    delts: "Shoulders",
    biceps: "Biceps",
    bicep: "Biceps",
    triceps: "Triceps",
    tricep: "Triceps",
    arms: "Arms",
    core: "Core",
    abs: "Core"
  };

  if (s in map) return map[s];
  if (s.includes("chest")) return "Chest";
  if (s.includes("back")) return "Back";
  if (s.includes("shoulder") || s.includes("delt")) return "Shoulders";
  if (s.includes("quad")) return "Quads";
  if (s.includes("ham")) return "Hamstrings";
  if (s.includes("glute")) return "Glutes";
  if (s.includes("calf")) return "Calves";
  if (s.includes("bicep")) return "Biceps";
  if (s.includes("tricep")) return "Triceps";
  if (s.includes("arm")) return "Arms";
  if (s.includes("core") || s.includes("ab")) return "Core";
  if (s.includes("leg")) return "Legs";
  if (!s) return "";
  return titleCase(s);
}

function parseMuscleList(raw: string) {
  const parts = raw
    .replace(/\band\b/gi, ",")
    .split(/[,/|&]+/g)
    .map((p) => normalizeMuscleToken(p))
    .filter(Boolean);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    unique.push(p);
  }
  return unique;
}

type SetsRepsMatch = { raw: string; display: string };

function extractSetsReps(text: string): SetsRepsMatch | null {
  const xMatch = text.match(
    /(\d+\s*(?:x|×)\s*\d+(?:\s*-\s*\d+)?(?:\s*@\s*[^,;]+)?(?:\s*RPE\s*\d+(?:\.\d+)?)?)/i
  );
  if (xMatch?.[1]) {
    const raw = xMatch[1].trim();
    const display = raw.replace(/×/g, "x").replace(/\s+/g, " ").trim();
    return { raw, display };
  }

  const setsOfReps = text.match(
    /(\d+)\s*sets?\s*(?:of|x|×)\s*(\d+(?:\s*-\s*\d+)?)(?:\s*reps?)?\b/i
  );
  if (setsOfReps) {
    const raw = setsOfReps[0].trim();
    const sets = setsOfReps[1];
    const reps = setsOfReps[2].replace(/\s+/g, "");
    return { raw, display: `${sets}x${reps}` };
  }

  const setsOfTime = text.match(
    /(\d+)\s*sets?\s*(?:of|x|×)\s*(\d+(?:\s*-\s*\d+)?)\s*(seconds?|sec|s|minutes?|min|m)\b/i
  );
  if (setsOfTime) {
    const raw = setsOfTime[0].trim();
    const sets = setsOfTime[1];
    const range = setsOfTime[2].replace(/\s+/g, "");
    const unitRaw = setsOfTime[3].toLowerCase();
    const unit = unitRaw.startsWith("m") ? "m" : "s";
    return { raw, display: `${sets}x${range}${unit}` };
  }

  return null;
}

function parseSingleSessionPlan(text: string): WorkoutPlan | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const exercises: PlanExercise[] = [];
  const tips: string[] = [];
  let targetMuscles: string[] = [];
  let mainMuscle: string | undefined;

  let activeExerciseIndex = -1;

  for (const raw of lines) {
    const line = stripInlineMarkdown(raw);
    if (!line) continue;

    const targetMatch = line.match(
      /^(target|focus|muscle(?:\s*group)?|primary|main)\s*[:\-–—]\s*(.+)$/i
    );
    if (targetMatch) {
      const parsed = parseMuscleList(targetMatch[2]);
      if (parsed.length > 0) targetMuscles = parsed;
      continue;
    }

    const cueMatch = line.match(/^(cues|tips|coaching|notes?)\s*[:\-–—]\s*(.+)$/i);
    if (cueMatch) {
      const cueText = cueMatch[2].trim();
      if (cueText) {
        const parts = cueText.split(/[•·]|(?:\s*;\s*)/g).map((p) => p.trim()).filter(Boolean);
        if (activeExerciseIndex >= 0) exercises[activeExerciseIndex].cues.push(...parts);
        else tips.push(...parts);
      }
      continue;
    }

    const bulletItem = raw.match(/^\s*(?:[-*•]|\d+[\.\)])\s*(.+)\s*$/)?.[1]?.trim();
    const candidate = bulletItem ?? line;

    const setsReps = extractSetsReps(candidate);
    if (setsReps) {
      const name = candidate
        .replace(setsReps.raw, "")
        .replace(/[:\-–—]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name.length >= 2) {
        exercises.push({ name, setsReps: setsReps.display, cues: [] });
        activeExerciseIndex = exercises.length - 1;
        continue;
      }
    }

    const nestedCue = raw.match(/^\s{2,}(?:[-*•])\s*(.+)\s*$/)?.[1]?.trim();
    if (nestedCue) {
      if (activeExerciseIndex >= 0) exercises[activeExerciseIndex].cues.push(stripInlineMarkdown(nestedCue));
      else tips.push(stripInlineMarkdown(nestedCue));
      continue;
    }

    if (activeExerciseIndex >= 0 && line.length <= 120) {
      exercises[activeExerciseIndex].cues.push(line);
    } else if (line.length <= 120) {
      tips.push(line);
    }
  }

  if (!mainMuscle && targetMuscles.length > 0) mainMuscle = targetMuscles[0];

  const day: PlanDay = {
    label: "Today",
    sessionName: undefined,
    mainMuscle,
    targetMuscles,
    exercises,
    tips
  };

  if (day.exercises.length < 3) return null;

  const counts = new Map<string, number>();
  const key = day.mainMuscle || day.targetMuscles[0];
  if (key) counts.set(key, 1);

  const muscleFrequency = Array.from(counts.entries())
    .map(([muscle, count]) => ({ muscle, count }))
    .sort((a, b) => b.count - a.count || a.muscle.localeCompare(b.muscle));

  return { title: "Today’s Plan", days: [day], muscleFrequency };
}

function parseWorkoutPlan(text: string): WorkoutPlan | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const dayHeadings: { index: number; label: string; sessionName?: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = stripInlineMarkdown(lines[i] || "");
    if (!rawLine) continue;

    const m = rawLine.match(
      /^(Day\s*\d+|Session\s*\d+|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:\s*[:\-–—]\s*(.+))?$/i
    );
    if (!m) continue;

    const label = titleCase(m[1].replace(/\s+/g, " ").trim());
    const sessionName = m[2] ? stripInlineMarkdown(m[2]) : undefined;
    dayHeadings.push({ index: i, label, sessionName });
  }

  if (dayHeadings.length < 1) return null;

  const titleCandidate = stripInlineMarkdown(lines.slice(0, dayHeadings[0].index).join(" ").trim());
  const title =
    titleCandidate && /plan|split|program|routine/i.test(titleCandidate) && titleCandidate.length <= 90
      ? titleCandidate
      : undefined;

  const days: PlanDay[] = [];

  for (let h = 0; h < dayHeadings.length; h++) {
    const start = dayHeadings[h].index + 1;
    const end = h + 1 < dayHeadings.length ? dayHeadings[h + 1].index : lines.length;
    const blockLines = lines.slice(start, end);

    let mainMuscle: string | undefined;
    let targetMuscles: string[] = [];
    const exercises: PlanExercise[] = [];
    const tips: string[] = [];

    const headingLineOriginal = stripInlineMarkdown(lines[dayHeadings[h].index] || "");
    const parenthetical = headingLineOriginal.match(/\(([^)]+)\)/)?.[1];
    if (parenthetical) {
      const parsed = parseMuscleList(parenthetical);
      if (parsed.length > 0) targetMuscles = parsed;
    }

    let activeExerciseIndex = -1;

    for (const raw of blockLines) {
      const line = stripInlineMarkdown(raw);
      if (!line) continue;

      const targetMatch = line.match(
        /^(target|focus|muscle(?:\s*group)?|primary|main)\s*[:\-–—]\s*(.+)$/i
      );
      if (targetMatch) {
        const parsed = parseMuscleList(targetMatch[2]);
        if (parsed.length > 0) targetMuscles = parsed;
        continue;
      }

      const cueMatch = line.match(/^(cues|tips|coaching|notes?)\s*[:\-–—]\s*(.+)$/i);
      if (cueMatch) {
        const cueText = cueMatch[2].trim();
        if (cueText) {
          const parts = cueText.split(/[•·]|(?:\s*;\s*)/g).map((p) => p.trim()).filter(Boolean);
          if (activeExerciseIndex >= 0) {
            exercises[activeExerciseIndex].cues.push(...parts);
          } else {
            tips.push(...parts);
          }
        }
        continue;
      }

      const bulletItem = raw.match(/^\s*(?:[-*•]|\d+[\.\)])\s*(.+)\s*$/)?.[1]?.trim();
      const candidate = bulletItem ?? line;

      const setsReps = extractSetsReps(candidate);
      if (setsReps) {
        const name = candidate
          .replace(setsReps.raw, "")
          .replace(/[:\-–—]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (name.length >= 2) {
          exercises.push({ name, setsReps: setsReps.display, cues: [] });
          activeExerciseIndex = exercises.length - 1;
          continue;
        }
      }

      const nestedCue = raw.match(/^\s{2,}(?:[-*•])\s*(.+)\s*$/)?.[1]?.trim();
      if (nestedCue) {
        if (activeExerciseIndex >= 0) exercises[activeExerciseIndex].cues.push(stripInlineMarkdown(nestedCue));
        else tips.push(stripInlineMarkdown(nestedCue));
        continue;
      }

      if (activeExerciseIndex >= 0 && line.length <= 120) {
        exercises[activeExerciseIndex].cues.push(line);
      } else if (line.length <= 120) {
        tips.push(line);
      }
    }

    if (!mainMuscle && targetMuscles.length > 0) mainMuscle = targetMuscles[0];

    const day: PlanDay = {
      label: dayHeadings[h].label,
      sessionName: dayHeadings[h].sessionName,
      mainMuscle,
      targetMuscles,
      exercises,
      tips
    };

    const hasEnough = day.exercises.length >= 2 || day.targetMuscles.length > 0;
    if (hasEnough) days.push(day);
  }

  if (days.length < 1) return null;

  const counts = new Map<string, number>();
  for (const d of days) {
    const key = d.mainMuscle || d.targetMuscles[0];
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const muscleFrequency = Array.from(counts.entries())
    .map(([muscle, count]) => ({ muscle, count }))
    .sort((a, b) => b.count - a.count || a.muscle.localeCompare(b.muscle));

  return { title, days, muscleFrequency };
}

function parseMuscleFrequencyFromText(text: string) {
  const freq = new Map<string, number>();

  const listRegex =
    /(?:^|\n)\s*(?:[-*•]|\d+[\.\)])?\s*([A-Za-z][A-Za-z\s/&]+?)\s*(?:[:\-–—]|\()\s*(\d+)\s*(?:x|times?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = listRegex.exec(text)) !== null) {
    const label = normalizeMuscleToken(m[1]);
    const count = Number(m[2]);
    if (!label || !Number.isFinite(count)) continue;
    freq.set(label, Math.max(freq.get(label) || 0, count));
  }

  const inlineRegex = /([A-Za-z][A-Za-z\s/&]+?)\s*\(\s*(\d+)\s*(?:x|times?)?\s*\)/gi;
  while ((m = inlineRegex.exec(text)) !== null) {
    const label = normalizeMuscleToken(m[1]);
    const count = Number(m[2]);
    if (!label || !Number.isFinite(count)) continue;
    freq.set(label, Math.max(freq.get(label) || 0, count));
  }

  return Array.from(freq.entries())
    .map(([muscle, count]) => ({ muscle, count }))
    .sort((a, b) => b.count - a.count || a.muscle.localeCompare(b.muscle));
}

function parseReport(text: string): TrainingReport | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const titleLine = stripInlineMarkdown(lines.find((l) => stripInlineMarkdown(l)) || "");
  const title = titleLine && /report/i.test(titleLine) ? titleLine : undefined;

  let period: string | undefined;
  const periodMatch = normalized.match(/\b(weekly|monthly|yearly)\s+report\b[^\n]*/i);
  if (periodMatch) period = stripInlineMarkdown(periodMatch[0]);

  let score: string | undefined;
  const scoreMatch = normalized.match(/\b(score|evaluation)\s*[:\-–—]\s*([^\n]+)/i);
  if (scoreMatch) score = stripInlineMarkdown(scoreMatch[2]).slice(0, 30);

  let evaluation: string | undefined;
  const evalLine = lines.find((l) => /\bevaluation\b/i.test(l) && /[:\-–—]/.test(l));
  if (evalLine) evaluation = stripInlineMarkdown(evalLine.split(/[:\-–—]/).slice(1).join(":").trim()).slice(0, 120);

  const trainingSummary: string[] = [];
  const weakPoints: string[] = [];
  const progressionHighlights: string[] = [];
  const nextSteps: string[] = [];

  let strongestArea: string | undefined;

  type Section = "summary" | "strongest" | "weak" | "highlights" | "next" | "none";
  let section: Section = "none";

  for (const raw of lines) {
    const line = stripInlineMarkdown(raw);
    if (!line) continue;

    const heading = line.match(
      /^(training summary|summary|strongest area|weak points?|progression highlights?|highlights|next steps?|next-step suggestions|suggestions|tóm tắt|tóm tắt tập luyện|điểm mạnh|điểm yếu|tiến triển|gợi ý|bước tiếp theo)\s*[:\-–—]?\s*(.*)$/i
    );
    if (heading) {
      const k = heading[1].toLowerCase();
      if (k.includes("summary") || k.includes("tóm tắt")) section = "summary";
      else if (k.includes("strongest") || k.includes("điểm mạnh")) section = "strongest";
      else if (k.includes("weak") || k.includes("điểm yếu")) section = "weak";
      else if (k.includes("highlight") || k.includes("tiến triển")) section = "highlights";
      else if (k.includes("next") || k.includes("suggest") || k.includes("gợi ý") || k.includes("bước")) section = "next";

      const rest = heading[2]?.trim();
      if (rest) {
        if (section === "summary") trainingSummary.push(rest);
        if (section === "strongest") strongestArea = rest;
        if (section === "weak") weakPoints.push(rest);
        if (section === "highlights") progressionHighlights.push(rest);
        if (section === "next") nextSteps.push(rest);
      }
      continue;
    }

    const bullet = raw.match(/^\s*(?:[-*•]|\d+[\.\)])\s*(.+)\s*$/)?.[1]?.trim();
    const item = bullet ? stripInlineMarkdown(bullet) : undefined;
    const payload = item ?? line;

    if (section === "summary") {
      if (payload.length <= 180) trainingSummary.push(payload);
      continue;
    }
    if (section === "strongest") {
      if (!strongestArea) strongestArea = payload;
      continue;
    }
    if (section === "weak") {
      if (payload.length <= 120) weakPoints.push(payload);
      continue;
    }
    if (section === "highlights") {
      if (payload.length <= 160) progressionHighlights.push(payload);
      continue;
    }
    if (section === "next") {
      if (payload.length <= 160) nextSteps.push(payload);
      continue;
    }
  }

  const muscleFrequency = parseMuscleFrequencyFromText(normalized);
  if (muscleFrequency.length < 2 && !/report/i.test(normalized)) return null;

  const inferredStrongest =
    strongestArea ||
    muscleFrequency.slice().sort((a, b) => b.count - a.count)[0]?.muscle ||
    undefined;

  const dedup = (arr: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr.map((x) => x.trim()).filter(Boolean)) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  };

  return {
    title,
    period,
    score,
    trainingSummary: dedup(trainingSummary).slice(0, 6),
    muscleFrequency: muscleFrequency.slice(0, 10),
    strongestArea: inferredStrongest,
    weakPoints: dedup(weakPoints).slice(0, 8),
    progressionHighlights: dedup(progressionHighlights).slice(0, 8),
    nextSteps: dedup(nextSteps).slice(0, 8),
    evaluation
  };
}

function detectStructured(text: string): Structured | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const workoutSessionSignals =
    /^workout session\b/im.test(normalized) ||
    /\nworkout session\b/i.test(normalized) ||
    /^started\b/i.test(normalized) ||
    /^saved:\b/i.test(normalized) ||
    /^resumed\b/i.test(normalized) ||
    /^restarted\b/i.test(normalized);

  if (workoutSessionSignals && /\bworkout session\b/i.test(normalized)) {
    const lines = normalized.split("\n").map((l) => stripInlineMarkdown(l)).filter(Boolean);
    const wsIndex = lines.findIndex((l) => /^workout session\b/i.test(l));
    const headerLine = wsIndex > 0 ? lines.slice(0, wsIndex).join(" ").trim() : undefined;
    const after = wsIndex >= 0 ? lines.slice(wsIndex + 1) : lines;
    const get = (prefix: string) => {
      const l = after.find((x) => x.toLowerCase().startsWith(prefix.toLowerCase()));
      if (!l) return undefined;
      return l.split(":").slice(1).join(":").trim() || undefined;
    };
    const cuesLine = get("Cues");
    const cues = cuesLine ? cuesLine.split(/[•·]|(?:\s*;\s*)/g).map((p) => p.trim()).filter(Boolean) : [];
    const session: WorkoutSessionCard = {
      headerLine,
      sessionTitle: get("Session"),
      exerciseName: get("Exercise"),
      target: get("Target"),
      cues,
      progressText: get("Progress")
    };
    return { kind: "workout_session", session };
  }

  const bodySignals =
    /\bbody metrics report\b/i.test(normalized) ||
    ((/\bweight\b/i.test(normalized) || /\bbody\s*fat\b/i.test(normalized) || /\bwaist\b/i.test(normalized)) &&
      /\btrend\b/i.test(normalized)) ||
    ((/\bweight\b/i.test(normalized) || /\bbody\s*fat\b/i.test(normalized) || /\bwaist\b/i.test(normalized)) &&
      (/\b7d\b/i.test(normalized) || /\b30d\b/i.test(normalized) || /\b1y\b/i.test(normalized)));

  if (bodySignals) {
    const metricMatch = normalized.match(/\bmetric\s*[:\-–—]\s*(weight_kg|body_fat_pct|waist_cm)\b/i);
    const rangeMatch = normalized.match(/\brange\s*[:\-–—]\s*(7d|30d|1y)\b/i);
    const metric = (metricMatch?.[1]?.toLowerCase() as BodyMetricKey | undefined) || "weight_kg";
    const rangeDays = rangeMatch?.[1]?.toLowerCase() === "7d" ? 7 : rangeMatch?.[1]?.toLowerCase() === "1y" ? 365 : 30;
    const summaryLines = normalized
      .split("\n")
      .map((l) => stripInlineMarkdown(l))
      .filter((l) => l && !/^body metrics report\b/i.test(l) && !/^metric\b/i.test(l) && !/^range\b/i.test(l))
      .slice(0, 6);

    return {
      kind: "body_metrics_report",
      report: { title: "Body Metrics Report", rangeDays, metric, summaryLines }
    };
  }

  const reportSignals =
    /\b(weekly|monthly|yearly)\s+report\b/i.test(normalized) ||
    /\btraining summary\b/i.test(normalized) ||
    /\bmuscle groups trained\b/i.test(normalized) ||
    /\bstrongest area\b/i.test(normalized) ||
    /\bweak points?\b/i.test(normalized) ||
    /\bprogression highlights?\b/i.test(normalized) ||
    /\bnext steps?\b/i.test(normalized) ||
    /\bscore\b/i.test(normalized) ||
    /\bevaluation\b/i.test(normalized) ||
    /\b(tóm tắt|báo cáo|điểm mạnh|điểm yếu|tiến triển|gợi ý|bước tiếp theo)\b/i.test(normalized);

  if (reportSignals) {
    const report = parseReport(normalized);
    if (report) return { kind: "report", report };
  }

  const hasDayMarkers = /(^|\n)\s*(?:#{1,4}\s*)?(?:[*_~`]{0,2})?(Day\s*\d+|Session\s*\d+|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/im.test(
    normalized
  );

  const planSignals =
    hasDayMarkers &&
    !/\breport\b/i.test(normalized) &&
    !/\bhistory\b/i.test(normalized) &&
    (/\bworkout\b/i.test(normalized) || /\bplan\b/i.test(normalized) || /\bsets?\b/i.test(normalized));

  if (planSignals) {
    const plan = parseWorkoutPlan(normalized);
    if (plan) return { kind: "workout_plan", plan };
  }

  const setsSignals =
    /(^|\n)\s*(?:[-*•]|\d+[\.\)])?\s*[A-Za-z0-9][^\n]{0,80}\b\d+\s*(?:x|×)\s*\d+/i.test(
      normalized
    ) ||
    /\b\d+\s*sets?\s*(?:of|x|×)\s*\d+/i.test(normalized);

  if (setsSignals && !/\breport\b/i.test(normalized) && !/\bhistory\b/i.test(normalized)) {
    const plan = parseSingleSessionPlan(normalized);
    if (plan) return { kind: "workout_plan", plan };
  }

  return null;
}

const ACCENTS = [
  {
    border: "border-emerald-500/35",
    bg: "bg-emerald-500/5",
    text: "text-emerald-300",
    badge: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20"
  },
  {
    border: "border-sky-500/35",
    bg: "bg-sky-500/5",
    text: "text-sky-300",
    badge: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/20"
  },
  {
    border: "border-amber-500/35",
    bg: "bg-amber-500/5",
    text: "text-amber-300",
    badge: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20"
  },
  {
    border: "border-rose-500/35",
    bg: "bg-rose-500/5",
    text: "text-rose-300",
    badge: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/20"
  },
  {
    border: "border-violet-500/35",
    bg: "bg-violet-500/5",
    text: "text-violet-300",
    badge: "bg-violet-500/10 text-violet-200 ring-1 ring-violet-500/20"
  }
];

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-950/40 px-2 py-0.5 text-[11px] text-zinc-200 ring-1 ring-zinc-800">
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold tracking-wide text-zinc-300">{children}</div>;
}

function MuscleBars({
  muscleFrequency,
  barFillClassName = "bg-zinc-200/80",
  containerClassName = "rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3"
}: {
  muscleFrequency: MuscleFrequency[];
  barFillClassName?: string;
  containerClassName?: string;
}) {
  const max = Math.max(...muscleFrequency.map((m) => m.count), 1);

  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between">
        <SectionTitle>Muscle Frequency</SectionTitle>
        <Pill>{muscleFrequency.reduce((acc, m) => acc + m.count, 0)} total</Pill>
      </div>
      <div className="mt-3 space-y-2">
        {muscleFrequency.map((m) => (
          <div key={m.muscle} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm text-zinc-100">{m.muscle}</div>
                <div className="text-xs text-zinc-400">{m.count}x</div>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-900">
                <div
                  className={`h-1.5 rounded-full ${barFillClassName}`}
                  style={{ width: `${Math.round((m.count / max) * 100)}%` }}
                />
              </div>
            </div>
            <span className="hidden sm:inline-flex">
              <Pill>{m.count} sessions</Pill>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkoutPlanMessage({ plan }: { plan: WorkoutPlan }) {
  return (
    <div className="w-full">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-zinc-100">
              {plan.title || "Workout Plan"}
            </div>
            <div className="mt-0.5 text-xs text-zinc-400">
              {plan.days.length} sessions
              {plan.muscleFrequency.length ? ` • ${plan.muscleFrequency.length} muscle groups` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plan.muscleFrequency.slice(0, 4).map((m) => (
              <Pill key={m.muscle}>
                {m.muscle} {m.count}x
              </Pill>
            ))}
          </div>
        </div>

        {plan.muscleFrequency.length ? (
          <div className="mt-4">
            <MuscleBars muscleFrequency={plan.muscleFrequency} />
          </div>
        ) : null}

        <div className={plan.days.length > 1 ? "mt-4 grid gap-3 sm:grid-cols-2" : "mt-4 grid gap-3"}>
          {plan.days.map((d, idx) => {
            const accent = ACCENTS[idx % ACCENTS.length];
            return (
              <div
                key={`${d.label}-${idx}`}
                className={`rounded-2xl border ${accent.border} ${accent.bg} p-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-100">
                      {d.label}
                      {d.sessionName ? (
                        <span className="ml-2 font-medium text-zinc-300">• {d.sessionName}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {d.targetMuscles.length ? (
                        <>
                          {d.targetMuscles.slice(0, 3).map((m) => (
                            <Pill key={m}>{m}</Pill>
                          ))}
                        </>
                      ) : (
                        <Pill>Session</Pill>
                      )}
                    </div>
                  </div>
                  {d.mainMuscle ? (
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${accent.badge}`}>
                      {d.mainMuscle}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {d.exercises.map((ex, exIdx) => (
                    <div key={`${ex.name}-${exIdx}`} className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="min-w-0 truncate text-sm text-zinc-100">{ex.name}</div>
                        {ex.setsReps ? (
                          <div className={`shrink-0 text-xs font-semibold ${accent.text}`}>{ex.setsReps}</div>
                        ) : null}
                      </div>
                      {ex.cues.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ex.cues.slice(0, 4).map((c, cueIdx) => (
                            <span
                              key={`${c}-${cueIdx}`}
                              className="inline-flex items-center rounded-full bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-800"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {d.tips.length ? (
                  <div className="mt-4">
                    <SectionTitle>Coaching</SectionTitle>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.tips.slice(0, 5).map((t, tIdx) => (
                        <span
                          key={`${t}-${tIdx}`}
                          className="inline-flex items-center rounded-full bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-800"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((t, idx) => (
        <span
          key={`${t}-${idx}`}
          className="inline-flex items-center rounded-full bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-200 ring-1 ring-zinc-800"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function ReportMessage({ report }: { report: TrainingReport }) {
  const summaryCard =
    "border-sky-500/25 bg-gradient-to-br from-sky-500/10 to-zinc-950/60";
  const freqCard =
    "border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-zinc-950/60";
  const strongCard =
    "border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-zinc-950/60";
  const weakCard =
    "border-rose-500/25 bg-gradient-to-br from-rose-500/10 to-zinc-950/60";
  const progCard =
    "border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-zinc-950/60";
  const nextCard =
    "border-sky-500/25 bg-gradient-to-br from-sky-500/10 to-zinc-950/60";

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-zinc-100">
              {report.title || report.period || "Training Report"}
            </div>
            {report.period && report.title !== report.period ? (
              <div className="mt-0.5 text-xs text-zinc-400">{report.period}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {report.score ? (
              <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-950">
                Score {report.score}
              </span>
            ) : null}
            {report.strongestArea ? <Pill>Strongest: {report.strongestArea}</Pill> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className={`rounded-2xl border p-3 ${summaryCard}`}>
            <SectionTitle>Training Summary</SectionTitle>
            <div className="mt-2 space-y-2">
              {(report.trainingSummary.length ? report.trainingSummary : ["Summary not provided."]).map((s, idx) => (
                <div key={`${s}-${idx}`} className="rounded-xl border border-zinc-900 bg-zinc-950/40 p-3 text-sm text-zinc-100">
                  {s}
                </div>
              ))}
            </div>
          </div>

          {report.muscleFrequency.length ? (
            <MuscleBars
              muscleFrequency={report.muscleFrequency}
              barFillClassName="bg-amber-200/80"
              containerClassName={`rounded-2xl border p-3 ${freqCard}`}
            />
          ) : (
            <div className={`rounded-2xl border p-3 ${freqCard}`}>
              <SectionTitle>Muscle Frequency</SectionTitle>
              <div className="mt-2 text-sm text-zinc-400">Not enough data.</div>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className={`rounded-2xl border p-3 ${strongCard}`}>
            <SectionTitle>Strongest Area</SectionTitle>
            <TagList items={report.strongestArea ? [report.strongestArea] : []} />
          </div>
          <div className={`rounded-2xl border p-3 ${weakCard}`}>
            <SectionTitle>Weak Points</SectionTitle>
            <TagList items={report.weakPoints.length ? report.weakPoints : ["None flagged"]} />
          </div>
          <div className={`rounded-2xl border p-3 ${progCard}`}>
            <SectionTitle>Progression</SectionTitle>
            <TagList
              items={report.progressionHighlights.length ? report.progressionHighlights : ["No highlights captured"]}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className={`rounded-2xl border p-3 ${nextCard}`}>
            <SectionTitle>Next Steps</SectionTitle>
            <TagList items={report.nextSteps.length ? report.nextSteps : ["Keep consistency and log your sets"]} />
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
            <SectionTitle>Evaluation</SectionTitle>
            <div className="mt-2 text-sm text-zinc-100">{report.evaluation || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMetricLabel(metric: BodyMetricKey) {
  if (metric === "weight_kg") return "Weight";
  if (metric === "body_fat_pct") return "Body Fat";
  return "Waist";
}

function formatMetricUnit(metric: BodyMetricKey) {
  if (metric === "weight_kg") return "kg";
  if (metric === "body_fat_pct") return "%";
  return "cm";
}

function toSparklinePoints(values: number[], width: number, height: number, padding: number) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.00001);
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  return values
    .map((v, i) => {
      const x = padding + (innerW * (values.length === 1 ? 0 : i / (values.length - 1)));
      const y = padding + innerH - ((v - min) / range) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function BodyMetricsChart({
  metric,
  rangeDays
}: {
  metric: BodyMetricKey;
  rangeDays: number;
}) {
  const [range, setRange] = useState<number>(rangeDays);
  const [points, setPoints] = useState<Array<{ date: string; value: number }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const r = range <= 7 ? "7d" : range >= 365 ? "1y" : "30d";
        const res = await fetch(`/api/body-metrics?metric=${encodeURIComponent(metric)}&range=${r}`);
        const json = (await res.json()) as { points?: Array<{ date?: unknown; value?: unknown }> };
        const next =
          json.points
            ?.map((p) => ({
              date: typeof p.date === "string" ? p.date : "",
              value: typeof p.value === "number" ? p.value : Number(p.value)
            }))
            .filter((p) => p.date && Number.isFinite(p.value)) ?? [];
        if (!cancelled) setPoints(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [metric, range]);

  const values = points.map((p) => p.value);
  const width = 520;
  const height = 120;
  const padding = 10;
  const polyline = toSparklinePoints(values, width, height, padding);
  const latest = points[points.length - 1];
  const unit = formatMetricUnit(metric);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>{formatMetricLabel(metric)} Trend</SectionTitle>
        <div className="flex items-center gap-2">
          {latest ? <Pill>{latest.value.toFixed(1)}{unit}</Pill> : null}
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              type="button"
              onClick={() => setRange(7)}
              className={range === 7 ? "rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-950" : "rounded-md px-2 py-1 text-[11px] text-zinc-300"}
            >
              7d
            </button>
            <button
              type="button"
              onClick={() => setRange(30)}
              className={range === 30 ? "rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-950" : "rounded-md px-2 py-1 text-[11px] text-zinc-300"}
            >
              30d
            </button>
            <button
              type="button"
              onClick={() => setRange(365)}
              className={range === 365 ? "rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-950" : "rounded-md px-2 py-1 text-[11px] text-zinc-300"}
            >
              1y
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : points.length < 2 ? (
          <div className="text-sm text-zinc-400">Not enough data yet.</div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-[120px] w-full"
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke="rgba(244,244,245,0.85)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={polyline}
            />
          </svg>
        )}
      </div>
      {latest?.date ? <div className="mt-1 text-[11px] text-zinc-500">Latest: {latest.date}</div> : null}
    </div>
  );
}

function BodyMetricsReportMessage({ report }: { report: BodyMetricsReport }) {
  const options: BodyMetricKey[] = ["weight_kg", "body_fat_pct", "waist_cm"];

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-zinc-100">{report.title || "Body Metrics"}</div>
            <div className="mt-0.5 text-xs text-zinc-400">{report.rangeDays} days</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((k) => (
              <Pill key={k}>{formatMetricLabel(k)}</Pill>
            ))}
          </div>
        </div>

        {report.summaryLines.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {report.summaryLines.map((s, idx) => (
              <div key={`${s}-${idx}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-100">
                {s}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {options.map((k) => (
            <BodyMetricsChart key={k} metric={k} rangeDays={report.rangeDays} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkoutSessionMessage({ session }: { session: WorkoutSessionCard }) {
  const accent = ACCENTS[0];
  return (
    <div className="w-full">
      <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-zinc-100">Workout</div>
            <div className="mt-0.5 text-xs text-zinc-400">{session.sessionTitle || "Session"}</div>
          </div>
          {session.progressText ? (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${accent.badge}`}>
              {session.progressText}
            </span>
          ) : null}
        </div>

        {session.headerLine ? (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-100">
            {session.headerLine}
          </div>
        ) : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className={`rounded-2xl border ${accent.border} ${accent.bg} p-4`}>
            <SectionTitle>Current Exercise</SectionTitle>
            <div className="mt-2 text-base font-semibold text-zinc-100">
              {session.exerciseName || "—"}
            </div>
            {session.target ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill>Target {session.target}</Pill>
              </div>
            ) : null}
            {session.cues.length ? (
              <div className="mt-3">
                <SectionTitle>Cues</SectionTitle>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {session.cues.slice(0, 5).map((c, idx) => (
                    <span
                      key={`${c}-${idx}`}
                      className="inline-flex items-center rounded-full bg-zinc-900/60 px-2 py-0.5 text-[11px] text-zinc-200 ring-1 ring-zinc-800"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <SectionTitle>Input</SectionTitle>
            <div className="mt-2 text-sm text-zinc-100">Log sets like 40x10 or 40x10x3</div>
            <div className="mt-2 text-xs text-zinc-400">Commands: next exercise, finish exercise, report today</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StructuredAssistantMessage({ content }: { content: string }) {
  const structured = useMemo(() => detectStructured(content), [content]);

  if (!structured) {
    return <div className="whitespace-pre-wrap text-sm text-zinc-100">{content}</div>;
  }

  if (structured.kind === "workout_plan") return <WorkoutPlanMessage plan={structured.plan} />;
  if (structured.kind === "body_metrics_report") return <BodyMetricsReportMessage report={structured.report} />;
  if (structured.kind === "workout_session") return <WorkoutSessionMessage session={structured.session} />;
  return <ReportMessage report={structured.report} />;
}
