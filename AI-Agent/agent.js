import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY in .env file!");
}
if (!process.env.TAVILY_API_KEY) {
  throw new Error("Missing TAVILY_API_KEY in .env file!");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function queryTavily(payload) {
  const res = await fetch("https://tavily.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      search_depth: "basic",
      ...payload,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Tavily HTTP Error:", res.status, errText);
    throw new Error(`Tavily API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  console.log(
    `Tavily [${payload.query}] returned:`,
    data.results?.length || 0,
    "results"
  );
  return data.results || [];
}

async function webSearch(query) {
  try {
    const rawResults = await queryTavily({
      query,
      max_results: 5,
    });

    const results = rawResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return { query, results };
  } catch (error) {
    return { query, error: error.message };
  }
}

async function searchYouTube(query) {
  try {
    
    let rawResults = await queryTavily({
      query: `${query} youtube`,
      include_domains: ["youtube.com", "youtu.be", "://youtube.com"],
      max_results: 10,
    });

    console.log(
      "Raw YouTube URLs:",
      rawResults.map((r) => r.url)
    );

   
    let videos = rawResults.filter(
      (r) => r.url.includes("watch?v=") || r.url.includes("youtu.be/")
    );

    
    if (videos.length === 0) {
      const broaderQuery = query
        .replace(/episode\s*\d+|ep\s*\d+|\b\d+\b/gi, "")
        .trim();

      if (broaderQuery && broaderQuery !== query) {
        const fallbackRaw = await queryTavily({
          query: `${broaderQuery} episode clip youtube`,
          include_domains: ["youtube.com", "youtu.be", "://youtube.com"],
          max_results: 10,
        });

        videos = fallbackRaw.filter(
          (r) => r.url.includes("watch?v=") || r.url.includes("youtu.be/")
        );

        if (videos.length === 0 && fallbackRaw.length > 0) {
          videos = fallbackRaw;
        }
      }
    }

    
    if (videos.length === 0 && rawResults.length > 0) {
      videos = rawResults;
    }

    const results = videos.slice(0, 5).map((r) => ({
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
  description:
    "Search the live web for general information, news, or articles.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING" },
    },
    required: ["query"],
  },
};

const youtubeSearchTool = {
  name: "searchYouTube",
  description:
    "Search YouTube specifically to find real video titles and direct youtube.com links. Use short, simple keywords.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "STRING" },
    },
    required: ["query"],
  },
};

const TOOLS = [webSearchTool, youtubeSearchTool];

const TOOL_HANDLERS = {
  webSearch: async (args) => await webSearch(args.query),
  searchYouTube: async (args) => await searchYouTube(args.query),
};

export async function runAgent(userInstruction) {
  const MAX_STEPS = 25;
  const contents = [{ role: "user", parts: [{ text: userInstruction }] }];
  const logs = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents,
      config: {
        systemInstruction: `You are a helpful assistant with live web and YouTube search tools.
- When a user asks for videos or YouTube links, call \`searchYouTube\` using short, simple keywords.
- ALWAYS share the exact \`url\` values returned by \`searchYouTube\` in your answer.
- If the exact episode is not in the results, share the closest matching videos, clips, or official YouTube links returned by the tool and briefly mention what they are—NEVER refuse or say you have technical difficulties if the tool returned any URLs.
- Never invent or guess URLs.`,
        tools: [{ functionDeclarations: TOOLS }],
      },
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
