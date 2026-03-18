# GymBro MCP

Minimalist ChatGPT-style fitness coach with:
- Supabase Auth (email/password)
- Supabase DB persistence (threads, messages, memories, workouts)
- MCP tool usage via Tavily (shows “🔍 Searching...”)
- OpenAI-compatible `/api/chat` route
- Vercel-ready Next.js App Router app

## Setup

1) Install deps

```bash
npm install
```

2) Create `.env.local`

Copy from [.env.example](./.env.example) and fill:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same values)
- `OPENAI_API_KEY`, optionally `OPENAI_BASE_URL`, `OPENAI_MODEL`
- `TAVILY_API_KEY`

3) Supabase tables

This project expects the existing tables listed in [schema.sql](./supabase/schema.sql). If your Supabase project already has them, skip this.

4) Start

```bash
npm run dev
```

Open:
- `http://localhost:3000/login`
- `http://localhost:3000/chat`

## Behavior

- The assistant system prompt is “Gym Bro”: short, direct, motivating, practical.
- If the user asks for latest fitness/nutrition/research info, the server will call Tavily and the UI shows “🔍 Searching...”.
- If the user asks “report this week”, the assistant summarizes recent workouts loaded from Supabase.

## Deployment (Vercel)

- Add the same env vars in Vercel Project Settings.
- Ensure Supabase Auth redirect URLs include your Vercel domain (Supabase dashboard → Auth → URL Configuration).
