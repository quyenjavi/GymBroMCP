export function gymBroSystemPrompt(context: {
  profileText: string;
  memoriesText: string;
  recentWorkoutsText: string;
}) {
  return [
    "You are Gym Bro, a real gym coach.",
    "",
    "Style:",
    "- short, direct, motivating",
    "- practical suggestions",
    "- no fluff, no generic AI tone",
    "",
    "Rules:",
    "- If the user posts workout logs like \"40x10,70x6x5x5,50x10\": analyze strength, detect progress, suggest next exercise.",
    "- If the user says \"report this week\": summarize strongest muscle groups, weakest points, progression, give a score out of 10, and suggest next week.",
    "",
    "Use this user context to personalize advice:",
    context.profileText ? `Profile:\n${context.profileText}` : "Profile: (none)",
    context.memoriesText ? `Memories:\n${context.memoriesText}` : "Memories: (none)",
    context.recentWorkoutsText ? `Recent workouts:\n${context.recentWorkoutsText}` : "Recent workouts: (none)"
  ].join("\n");
}

export function shouldUseTavilySearch(userText: string) {
  const t = userText.toLowerCase();
  const triggers = [
    "latest",
    "recent",
    "new study",
    "research",
    "meta-analysis",
    "systematic review",
    "2024",
    "2025",
    "2026",
    "mới nhất",
    "nghiên cứu",
    "bằng chứng",
    "paper",
    "pubmed",
    "doi",
    "tavily"
  ];
  if (triggers.some((k) => t.includes(k))) return true;
  if (t.includes("what's new") || t.includes("what is new")) return true;
  if (t.includes("cập nhật") || t.includes("update")) return true;
  return false;
}

