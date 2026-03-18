export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at?: string;
  tool_name?: string | null;
};
