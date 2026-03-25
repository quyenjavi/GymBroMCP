create extension if not exists "pgcrypto";

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  gender text,
  age integer,
  height_cm numeric,
  weight_kg numeric,
  fitness_goal text,
  fitness_level text,
  preferred_split text,
  training_days_per_week integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text,
  tool_name text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_key text,
  memory_value text,
  importance integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  session_date date,
  workout_type text,
  title text,
  notes text,
  perceived_score numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_order integer,
  muscle_group text,
  exercise_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_order integer,
  weight_kg numeric,
  reps integer,
  duration_sec integer,
  distance_m numeric,
  rpe numeric(3,1),
  rir integer,
  rest_seconds integer,
  distance_km numeric(6,2),
  duration_seconds integer,
  is_warmup boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.workout_sessions
add column if not exists started_at timestamptz,
add column if not exists ended_at timestamptz,
add column if not exists duration_minutes integer,
add column if not exists session_type text,
add column if not exists status text not null default 'completed',
add column if not exists source text not null default 'manual',
add column if not exists updated_at timestamptz not null default now();

alter table public.workout_exercises
add column if not exists movement_pattern text,
add column if not exists equipment text,
add column if not exists is_compound boolean not null default false,
add column if not exists updated_at timestamptz not null default now();

create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg numeric(5,2),
  body_fat_pct numeric(5,2),
  muscle_mass_kg numeric(5,2),
  skeletal_muscle_kg numeric(5,2),
  bmi numeric(5,2),
  waist_cm numeric(5,2),
  chest_cm numeric(5,2),
  hip_cm numeric(5,2),
  arm_cm numeric(5,2),
  thigh_cm numeric(5,2),
  note text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_url text not null,
  photo_type text,
  taken_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.workout_plans(id) on delete cascade,
  day_of_week integer,
  title text not null,
  session_type text,
  notes text,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_plan_day_exercises (
  id uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.workout_plan_days(id) on delete cascade,
  exercise_name text not null,
  muscle_group text,
  target_sets integer,
  target_reps_min integer,
  target_reps_max integer,
  target_rpe numeric(3,1),
  display_order integer,
  cues text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  reminder_type text not null,
  scheduled_at timestamptz,
  recurrence_rule text,
  timezone text not null default 'Asia/Tokyo',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid references public.user_reminders(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  provider text,
  external_event_id text,
  status text not null default 'confirmed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tool_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  tool_name text not null,
  input jsonb not null,
  output jsonb,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_memories enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_metrics enable row level security;
alter table public.progress_photos enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_plan_days enable row level security;
alter table public.workout_plan_day_exercises enable row level security;
alter table public.user_reminders enable row level security;
alter table public.calendar_events enable row level security;
alter table public.tool_executions enable row level security;

create policy "profiles_read_own"
on public.user_profiles for select
using (auth.uid() = id);

create policy "profiles_upsert_own"
on public.user_profiles for insert
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.user_profiles for update
using (auth.uid() = id);

create policy "threads_crud_own"
on public.chat_threads for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "messages_crud_own"
on public.chat_messages for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "memories_crud_own"
on public.user_memories for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "sessions_crud_own"
on public.workout_sessions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "exercises_crud_own"
on public.workout_exercises for all
using (
  exists (
    select 1
    from public.workout_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  )
);

create policy "sets_crud_own"
on public.workout_sets for all
using (
  exists (
    select 1
    from public.workout_exercises e
    join public.workout_sessions s on s.id = e.session_id
    where e.id = exercise_id and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_exercises e
    join public.workout_sessions s on s.id = e.session_id
    where e.id = exercise_id and s.user_id = auth.uid()
  )
);

create policy "body_metrics_crud_own"
on public.body_metrics for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "progress_photos_crud_own"
on public.progress_photos for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "plans_crud_own"
on public.workout_plans for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "plan_days_crud_own"
on public.workout_plan_days for all
using (
  exists (
    select 1
    from public.workout_plans p
    where p.id = plan_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_plans p
    where p.id = plan_id and p.user_id = auth.uid()
  )
);

create policy "plan_day_exercises_crud_own"
on public.workout_plan_day_exercises for all
using (
  exists (
    select 1
    from public.workout_plan_days d
    join public.workout_plans p on p.id = d.plan_id
    where d.id = plan_day_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_plan_days d
    join public.workout_plans p on p.id = d.plan_id
    where d.id = plan_day_id and p.user_id = auth.uid()
  )
);

create policy "reminders_crud_own"
on public.user_reminders for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "calendar_events_crud_own"
on public.calendar_events for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "tool_executions_crud_own"
on public.tool_executions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_chat_threads_user_created
on public.chat_threads (user_id, created_at desc);

create index if not exists idx_chat_messages_thread_created
on public.chat_messages (thread_id, created_at asc);

create index if not exists idx_chat_messages_user_created
on public.chat_messages (user_id, created_at desc);

create index if not exists idx_chat_messages_tool_name
on public.chat_messages (tool_name)
where tool_name is not null;

create index if not exists idx_chat_messages_metadata_gin
on public.chat_messages using gin (metadata);

create index if not exists idx_workout_sessions_user_date
on public.workout_sessions (user_id, session_date desc);

create index if not exists idx_workout_sessions_user_created
on public.workout_sessions (user_id, created_at desc);

create index if not exists idx_workout_sessions_user_type_date
on public.workout_sessions (user_id, session_type, session_date desc);

create index if not exists idx_workout_sessions_user_status_date
on public.workout_sessions (user_id, status, session_date desc);

create index if not exists idx_workout_exercises_session
on public.workout_exercises (session_id);

create index if not exists idx_workout_exercises_session_order
on public.workout_exercises (session_id, exercise_order);

create index if not exists idx_workout_exercises_muscle_group
on public.workout_exercises (muscle_group);

create index if not exists idx_workout_sets_exercise
on public.workout_sets (exercise_id);

create index if not exists idx_workout_sets_exercise_order
on public.workout_sets (exercise_id, set_order);

create index if not exists idx_body_metrics_user_measured
on public.body_metrics (user_id, measured_at desc);

create index if not exists idx_body_metrics_user_date
on public.body_metrics (user_id, date(measured_at));

create index if not exists idx_user_reminders_user_scheduled
on public.user_reminders (user_id, scheduled_at desc);

create index if not exists idx_user_reminders_user_status
on public.user_reminders (user_id, status);

create index if not exists idx_calendar_events_user_start
on public.calendar_events (user_id, starts_at desc);

create index if not exists idx_tool_executions_user_created
on public.tool_executions (user_id, created_at desc);

create index if not exists idx_tool_executions_thread_created
on public.tool_executions (thread_id, created_at desc);

create index if not exists idx_tool_executions_tool_status
on public.tool_executions (tool_name, status, created_at desc);

create index if not exists idx_tool_executions_input_gin
on public.tool_executions using gin (input);

create index if not exists idx_tool_executions_output_gin
on public.tool_executions using gin (output);

create or replace view public.workout_set_details_v as
select
  ws.id as set_id,
  s.user_id,
  s.id as session_id,
  s.session_date,
  coalesce(s.session_type, s.workout_type) as session_type,
  e.id as exercise_id,
  e.exercise_name as exercise_name,
  e.muscle_group,
  e.exercise_order,
  ws.set_order,
  ws.weight_kg,
  ws.reps,
  (coalesce(ws.weight_kg, 0) * coalesce(ws.reps, 0)) as volume,
  ws.rpe,
  ws.rir,
  ws.is_warmup,
  ws.created_at
from public.workout_sets ws
join public.workout_exercises e on e.id = ws.exercise_id
join public.workout_sessions s on s.id = e.session_id;

create or replace view public.workout_weekly_summary_v as
select
  user_id,
  date_trunc('week', session_date::timestamp)::date as week_start,
  count(distinct session_id) as total_sessions,
  count(set_id) filter (where coalesce(is_warmup, false) = false) as total_sets,
  sum(reps) as total_reps,
  sum(volume) as total_volume
from public.workout_set_details_v
group by user_id, date_trunc('week', session_date::timestamp)::date;

create or replace view public.workout_monthly_summary_v as
select
  user_id,
  date_trunc('month', session_date::timestamp)::date as month_start,
  count(distinct session_id) as total_sessions,
  count(set_id) filter (where coalesce(is_warmup, false) = false) as total_sets,
  sum(reps) as total_reps,
  sum(volume) as total_volume
from public.workout_set_details_v
group by user_id, date_trunc('month', session_date::timestamp)::date;

create or replace view public.workout_yearly_summary_v as
select
  user_id,
  date_trunc('year', session_date::timestamp)::date as year_start,
  count(distinct session_id) as total_sessions,
  count(set_id) filter (where coalesce(is_warmup, false) = false) as total_sets,
  sum(reps) as total_reps,
  sum(volume) as total_volume
from public.workout_set_details_v
group by user_id, date_trunc('year', session_date::timestamp)::date;

create or replace view public.muscle_group_progress_v as
select
  user_id,
  date_trunc('week', session_date::timestamp)::date as week_start,
  muscle_group,
  count(set_id) filter (where coalesce(is_warmup, false) = false) as total_sets,
  sum(volume) as total_volume
from public.workout_set_details_v
group by user_id, date_trunc('week', session_date::timestamp)::date, muscle_group;

create or replace view public.exercise_pr_v as
select
  user_id,
  exercise_name,
  max(weight_kg) as max_weight_kg,
  max(volume) as max_set_volume,
  max(case when reps = 1 then weight_kg end) as best_single_kg
from public.workout_set_details_v
where coalesce(is_warmup, false) = false
group by user_id, exercise_name;

create or replace view public.workout_session_summary_v as
select
  s.id as session_id,
  s.user_id,
  s.session_date,
  s.title,
  coalesce(s.session_type, s.workout_type) as session_type,
  count(distinct e.id) as total_exercises,
  count(ws.id) filter (where coalesce(ws.is_warmup, false) = false) as total_sets,
  sum(ws.reps) as total_reps,
  sum(coalesce(ws.weight_kg,0) * coalesce(ws.reps,0)) as total_volume
from public.workout_sessions s
left join public.workout_exercises e on e.session_id = s.id
left join public.workout_sets ws on ws.exercise_id = e.id
group by s.id, s.user_id, s.session_date, s.title, coalesce(s.session_type, s.workout_type);

create or replace view public.body_metrics_daily_v as
select
  user_id,
  date(measured_at) as measure_date,
  avg(weight_kg) as weight_kg,
  avg(body_fat_pct) as body_fat_pct,
  avg(muscle_mass_kg) as muscle_mass_kg,
  avg(waist_cm) as waist_cm
from public.body_metrics
group by user_id, date(measured_at);

create or replace view public.latest_body_metrics_v as
select distinct on (user_id)
  user_id,
  measured_at,
  weight_kg,
  body_fat_pct,
  muscle_mass_kg,
  waist_cm,
  chest_cm,
  arm_cm,
  thigh_cm
from public.body_metrics
order by user_id, measured_at desc;
