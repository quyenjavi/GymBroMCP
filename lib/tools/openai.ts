export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export async function openAIChatComplete({
  messages,
  tools,
  toolChoice
}: {
  messages: OpenAIChatMessage[];
  tools?: OpenAITool[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
}) {
  const apiKey = getEnv("OPENAI_API_KEY");
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: toolChoice,
      temperature: 0.4
    })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`LLM error (${res.status}): ${text}`);

  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>;
  };
  const choice = json?.choices?.[0]?.message;
  if (!choice) throw new Error("LLM returned no choices");
  return choice;
}
