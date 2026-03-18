export type TavilySearchResult = {
  title: string;
  url: string;
  content?: string;
};

export async function tavilySearch(query: string) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as { results?: unknown };
  const rawResults = Array.isArray(json.results) ? json.results : [];
  const results: TavilySearchResult[] = rawResults.map((r) => {
    const obj = (r ?? {}) as Record<string, unknown>;
    return {
      title: typeof obj.title === "string" ? obj.title : "",
      url: typeof obj.url === "string" ? obj.url : "",
      content: typeof obj.content === "string" ? obj.content : undefined
    };
  });

  return { query, results };
}
