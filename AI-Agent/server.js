import { Hono } from "hono";
import { serve } from "@hono/node-server"; 
import { runAgent } from "./agent.js";
import { ok } from "assert";

const app = new Hono();

app.get("/health" , (c) => {
  return c.json({
    message: "Server is running",
    status: ok
  })
})
app.post("/api/agent", async (c) => {
  try {
    const body = await c.req.json();
    const { instruction } = body;

    if (!instruction) {
      return c.json({ error: "Missing 'instruction' in request body" }, 400);
    }

    const result = await runAgent(instruction);
    return c.json(result, 200);
  } catch (error) {
    console.error("Agent error:", error);
    return c.json({ error: error.message }, 500);
  }
});


serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Hono server running on http://localhost:${info.port}`);
});


