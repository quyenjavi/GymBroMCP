export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at?: string;
  tool_name?: string | null;
};

export type StreamEvent =
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "assistant"; content: string }
  | { type: "error"; message: string };
