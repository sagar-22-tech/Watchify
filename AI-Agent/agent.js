import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function webSearch(query) {
  try {
    const res = await fetch("https://tavily.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
      }),
    });

    if (!res.ok) {
      return { query, error: `Search API returned status ${res.status}` };
    }

    const data = await res.json();
    const results = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return { query, results };
  } catch (error) {
    return { query, error: error.message };
  }
}

const webSearchTool = {
  name: "webSearch",
  description: "Search the live web for current information, news, or facts you don't already know",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING" },
    },
    required: ["query"],
  },
};

const TOOLS = [webSearchTool];
const TOOL_HANDLERS = {
  webSearch: async (args) => await webSearch(args.query),
};

export async function runAgent(userInstruction) {
  const MAX_STEPS = 25;
  const contents = [
    { role: "user", parts: [{ text: userInstruction }] },
  ];
  const logs = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents,
      systemInstruction:
        "You are a careful agent. Before doing anything destructive or irreversible, explain what you're about to do. If a request is ambiguous, ask the user instead of guessing. Prefer the least destructive way to accomplish a task.",
      config: { tools: [{ functionDeclarations: TOOLS }] },
    });

    const calls = response.functionCalls;

    if (!calls || calls.length === 0) {
      return {
        answer: response.text,
        steps: logs,
      };
    }

    logs.push({ step: step + 1, tools: calls.map((c) => c.name) });
    contents.push(response.candidates[0].content);

    for (const call of calls) {
      const handler = TOOL_HANDLERS[call.name];
      if (!handler) {
        throw new Error(`Unknown tool: ${call.name}`);
      }

      const result = await handler(call.args);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: call.name,
              response: result,
            },
          },
        ],
      });
    }
  }

  throw new Error("Agent reached maximum steps without a final answer.");
}
