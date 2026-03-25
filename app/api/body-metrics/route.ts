import { NextResponse } from "next/server";

import { supabaseAdmin } from "../../../lib/supabase/admin";
import { supabaseServer } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type Metric = "weight_kg" | "body_fat_pct" | "waist_cm";
type Range = "7d" | "30d" | "1y";

function isMetric(v: string): v is Metric {
  return v === "weight_kg" || v === "body_fat_pct" || v === "waist_cm";
}

function isRange(v: string): v is Range {
  return v === "7d" || v === "30d" || v === "1y";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const metricParam = url.searchParams.get("metric") || "weight_kg";
  const rangeParam = url.searchParams.get("range") || "30d";

  const metric: Metric = isMetric(metricParam) ? metricParam : "weight_kg";
  const range: Range = isRange(rangeParam) ? rangeParam : "30d";

  const supabase = await supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const start = new Date(now);
  if (range === "7d") start.setDate(start.getDate() - 7);
  if (range === "30d") start.setDate(start.getDate() - 30);
  if (range === "1y") start.setDate(start.getDate() - 365);

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("body_metrics")
    .select(`measured_at, ${metric}`)
    .eq("user_id", user.id)
    .gte("measured_at", start.toISOString())
    .order("measured_at", { ascending: true })
    .limit(900);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byDate = new Map<string, { sum: number; count: number }>();

  for (const row of (data as Array<Record<string, unknown>> | null | undefined) ?? []) {
    const measuredAt = typeof row.measured_at === "string" ? row.measured_at : "";
    const raw = row[metric];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!measuredAt || !Number.isFinite(value)) continue;

    const day = new Date(measuredAt).toISOString().slice(0, 10);
    const prev = byDate.get(day) || { sum: 0, count: 0 };
    byDate.set(day, { sum: prev.sum + value, count: prev.count + 1 });
  }

  const points = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, agg]) => ({ date, value: agg.sum / Math.max(agg.count, 1) }));

  return NextResponse.json({ metric, range, points });
}

