import { Hono } from "hono";
import { cors } from "hono/cors";
import { UXArchitectAgent, type Env } from "./agent";

// Export the Agent class for Durable Objects
export { UXArchitectAgent };

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for API routes
app.use("/api/*", cors());

/**
 * Health check endpoint
 */
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * List all conversation threads
 */
app.get("/api/threads", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM threads ORDER BY updated_at DESC"
    ).all();
    return c.json({ threads: results });
  } catch (error) {
    console.error("Error listing threads:", error);
    return c.json({ error: "Failed to list threads" }, 500);
  }
});

/**
 * Create a new thread
 */
app.post("/api/threads", async (c) => {
  try {
    const body = await c.req.json<{ title?: string }>();
    const threadId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(
      "INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
      .bind(threadId, body.title || null, now, now)
      .run();

    return c.json({ threadId }, 201);
  } catch (error) {
    console.error("Error creating thread:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

/**
 * Get a specific thread with its messages
 */
app.get("/api/threads/:threadId", async (c) => {
  const threadId = c.req.param("threadId");

  try {
    const thread = await c.env.DB.prepare(
      "SELECT * FROM threads WHERE id = ?"
    )
      .bind(threadId)
      .first();

    if (!thread) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const { results: messages } = await c.env.DB.prepare(
      "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC"
    )
      .bind(threadId)
      .all();

    return c.json({ thread, messages });
  } catch (error) {
    console.error("Error fetching thread:", error);
    return c.json({ error: "Failed to fetch thread" }, 500);
  }
});

/**
 * Delete a thread and its messages
 */
app.delete("/api/threads/:threadId", async (c) => {
  const threadId = c.req.param("threadId");

  try {
    await c.env.DB.prepare("DELETE FROM threads WHERE id = ?")
      .bind(threadId)
      .run();

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting thread:", error);
    return c.json({ error: "Failed to delete thread" }, 500);
  }
});

/**
 * Send a message to the agent (chat endpoint)
 */
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<{ message: string; threadId?: string }>();

    if (!body.message) {
      return c.json({ error: "Message is required" }, 400);
    }

    // Get or create agent instance
    const agentId = body.threadId || crypto.randomUUID();
    const id = c.env.UX_ARCHITECT_AGENT.idFromName(agentId);
    const agent = c.env.UX_ARCHITECT_AGENT.get(id);

    // Forward request to agent
    const agentResponse = await agent.fetch(
      new Request("https://agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body.message, threadId: body.threadId }),
      })
    );

    const result = await agentResponse.json();

    // Persist messages to D1 as well for global queries
    if (result && typeof result === "object" && "response" in result) {
      const resultWithResponse = result as { response: string; threadId: string };
      const threadId = resultWithResponse.threadId;
      const now = Math.floor(Date.now() / 1000);

      // Ensure thread exists in D1
      await c.env.DB.prepare(
        `INSERT INTO threads (id, created_at, updated_at) 
         VALUES (?, ?, ?) 
         ON CONFLICT(id) DO UPDATE SET updated_at = ?`
      )
        .bind(threadId, now, now, now)
        .run();

      // Save user message
      await c.env.DB.prepare(
        "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(crypto.randomUUID(), threadId, "user", body.message, now)
        .run();

      // Save assistant response
      await c.env.DB.prepare(
        "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(crypto.randomUUID(), threadId, "assistant", resultWithResponse.response, now)
        .run();
    }

    return c.json(result);
  } catch (error) {
    console.error("Error in chat:", error);
    return c.json({ error: "Failed to process chat message" }, 500);
  }
});

/**
 * WebSocket upgrade for real-time agent communication
 */
app.get("/api/agent/:agentId", async (c) => {
  // The agents SDK uses URL pattern matching to route requests
  // We need to forward to the agent directly using the Durable Object
  const agentId = c.req.param("agentId");
  const id = c.env.UX_ARCHITECT_AGENT.idFromName(agentId);
  const agent = c.env.UX_ARCHITECT_AGENT.get(id);
  
  // Forward the request to the agent
  return agent.fetch(c.req.raw);
});

/**
 * Route to agent instance
 */
app.all("/api/agent/:agentId/*", async (c) => {
  const agentId = c.req.param("agentId");
  const id = c.env.UX_ARCHITECT_AGENT.idFromName(agentId);
  const agent = c.env.UX_ARCHITECT_AGENT.get(id);
  
  // Forward the request to the agent
  return agent.fetch(c.req.raw);
});

/**
 * Default export for Cloudflare Workers
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle API routes with Hono
    if (url.pathname.startsWith("/api")) {
      return app.fetch(request, env, ctx);
    }

    // For all other routes, serve static assets
    // The assets binding will handle SPA routing via not_found_handling config
    return env.ASSETS.fetch(request);
  },
};
