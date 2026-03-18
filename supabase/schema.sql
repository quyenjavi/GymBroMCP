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
  notes text,
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_memories enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

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
