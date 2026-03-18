import { redirect } from "next/navigation";

import ChatShell from "./ui/ChatShell";
import { supabaseAdmin } from "../../lib/supabase/admin";
import { supabaseServer } from "../../lib/supabase/server";
import type { ChatMessage } from "../../lib/types";

export const dynamic = "force-dynamic";

type ChatMessageRow = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name: string | null;
  created_at: string;
};

export default async function ChatPage() {
  const supabase = await supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = supabaseAdmin();

  const { data: existingThread } = await admin
    .from("chat_threads")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let threadId = existingThread?.id as string | undefined;
  if (!threadId) {
    const id = crypto.randomUUID();
    const created = await admin
      .from("chat_threads")
      .insert({ id, user_id: user.id, title: "Gym Bro" })
      .select("id")
      .single();
    if (created.error) throw new Error(`Failed to create chat thread: ${created.error.message}`);
    if (!created.data?.id) throw new Error("Failed to create chat thread: no id returned");
    threadId = created.data.id;
  }
  const threadIdFinal = threadId as string;

  const { data: messagesData } = await admin
    .from("chat_messages")
    .select("id, role, content, tool_name, created_at")
    .eq("thread_id", threadIdFinal)
    .order("created_at", { ascending: true })
    .limit(60);

  const initialMessages: ChatMessage[] = (messagesData as ChatMessageRow[] | null | undefined)?.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tool_name: m.tool_name,
    created_at: m.created_at
  })) ?? [];

  return (
    <ChatShell
      threadId={threadIdFinal}
      userEmail={user.email || ""}
      initialMessages={initialMessages}
    />
  );
}
