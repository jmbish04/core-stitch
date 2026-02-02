import { Agent } from "agents";
import OpenAI from "openai";

/**
 * Environment bindings interface for the Worker
 */
export interface Env {
  DB: D1Database;
  UX_ARCHITECT_AGENT: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  STITCH_API_KEY: string;
  ASSETS: Fetcher;
}

/**
 * Agent state interface for persisting conversation context
 */
interface AgentState {
  threadId: string | null;
  systemPrompt: string;
  conversationHistory: Message[];
}

/**
 * Message interface for conversation history
 */
interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  toolCallId?: string;
  createdAt: number;
}

/**
 * Thread interface for D1 persistence
 */
interface Thread {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

/**
 * MCP Server interface for type safety
 */
interface MCPServerInfo {
  state?: string;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>;
  client?: {
    callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * UX Architect Agent - A stateful agent that uses the Cloudflare Agents SDK
 * to wrap OpenAI's API and integrate with the Stitch Remote MCP Server.
 */
export class UXArchitectAgent extends Agent<Env, AgentState> {
  private openai: OpenAI | null = null;
  private mcpConnected: boolean = false;

  /**
   * System prompt defining the UX Architect persona
   */
  private readonly UX_ARCHITECT_SYSTEM_PROMPT = `You are a UX Architect, an expert in user experience design and interface architecture. Your role is to:

1. **Analyze Design Systems**: Break down complex UI/UX requirements into actionable design specifications.
2. **Drill Down into Details**: When discussing any design element, provide comprehensive details about:
   - Layout and composition
   - Typography and color schemes
   - Interaction patterns and micro-interactions
   - Accessibility considerations (WCAG compliance)
   - Responsive design strategies
   - Component hierarchy and reusability

3. **Use Stitch Tools**: Leverage the Stitch MCP server to access design resources, research user patterns, and validate design decisions.

4. **Be Collaborative**: Engage in iterative design discussions, ask clarifying questions, and propose multiple solutions when appropriate.

5. **Document Decisions**: Provide clear rationale for design recommendations and document key decisions for future reference.

Always prioritize user-centered design principles and maintain consistency with established design systems.`;

  /**
   * Initialize the agent when it starts
   */
  async onStart(): Promise<void> {
    // Initialize state if not already set
    if (!this.state) {
      this.setState({
        threadId: null,
        systemPrompt: this.UX_ARCHITECT_SYSTEM_PROMPT,
        conversationHistory: [],
      });
    }

    // Create database tables using Agent's built-in SQL storage
    this.sql`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  /**
   * Initialize OpenAI client lazily
   */
  private getOpenAIClient(): OpenAI {
    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey: this.env.OPENAI_API_KEY,
      });
    }
    return this.openai;
  }

  /**
   * Connect to the Stitch Remote MCP Server
   */
  async connectToStitch(): Promise<{ success: boolean; error?: string }> {
    if (this.mcpConnected) {
      return { success: true };
    }

    try {
      // Using the self URL as callback host for MCP server connection
      const result = await this.addMcpServer(
        "Stitch",
        "https://stitch.googleapis.com/mcp",
        "https://core-stitch.workers.dev", // Callback host - will be updated at deployment
        "agents",
        {
          transport: {
            headers: {
              "X-Goog-Api-Key": this.env.STITCH_API_KEY,
            },
          },
        }
      );

      // Check if authUrl is undefined (meaning we're connected)
      if (!result.authUrl) {
        this.mcpConnected = true;
        return { success: true };
      } else {
        return { success: false, error: `Authentication required: ${result.authUrl}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to connect to Stitch MCP:", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get available tools from connected MCP servers
   */
  private getMcpTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const mcpServers = this.getMcpServers() as unknown as Record<string, MCPServerInfo> | undefined;
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    if (!mcpServers || typeof mcpServers !== "object") {
      return tools;
    }

    for (const [, server] of Object.entries(mcpServers)) {
      if (server && server.state === "ready" && server.tools) {
        for (const tool of server.tools) {
          tools.push({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description || "",
              parameters: tool.inputSchema as Record<string, unknown>,
            },
          });
        }
      }
    }

    return tools;
  }

  /**
   * Create a new conversation thread
   */
  async createThread(title?: string): Promise<string> {
    const threadId = crypto.randomUUID();
    const now = Date.now();

    this.sql`
      INSERT INTO agent_threads (id, title, created_at, updated_at)
      VALUES (${threadId}, ${title || null}, ${now}, ${now})
    `;

    this.setState({
      ...this.state,
      threadId,
      conversationHistory: [],
    });

    return threadId;
  }

  /**
   * Load an existing thread and its messages
   */
  async loadThread(threadId: string): Promise<boolean> {
    const threads = this.sql<{ id: string }>`
      SELECT id FROM agent_threads WHERE id = ${threadId}
    `;

    if (threads.length === 0) {
      return false;
    }

    const messages = this.sql<{
      id: string;
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      created_at: number;
    }>`
      SELECT * FROM agent_messages 
      WHERE thread_id = ${threadId} 
      ORDER BY created_at ASC
    `;

    const conversationHistory: Message[] = messages.map((msg) => ({
      id: msg.id,
      role: msg.role as Message["role"],
      content: msg.content,
      toolCalls: msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined,
      toolCallId: msg.tool_call_id || undefined,
      createdAt: msg.created_at,
    }));

    this.setState({
      ...this.state,
      threadId,
      conversationHistory,
    });

    return true;
  }

  /**
   * List all threads
   */
  async listThreads(): Promise<Thread[]> {
    return this.sql<Thread>`
      SELECT * FROM agent_threads ORDER BY updated_at DESC
    `;
  }

  /**
   * Persist a message to the agent's database
   */
  private persistMessage(message: Message): void {
    this.sql`
      INSERT INTO agent_messages (id, thread_id, role, content, tool_calls, tool_call_id, created_at)
      VALUES (
        ${message.id},
        ${this.state.threadId},
        ${message.role},
        ${message.content},
        ${message.toolCalls ? JSON.stringify(message.toolCalls) : null},
        ${message.toolCallId || null},
        ${message.createdAt}
      )
    `;

    // Update thread's updated_at timestamp
    const now = Date.now();
    this.sql`
      UPDATE agent_threads SET updated_at = ${now} WHERE id = ${this.state.threadId}
    `;
  }

  /**
   * Process a user message and generate a response
   */
  async chat(userMessage: string): Promise<{
    response: string;
    threadId: string;
  }> {
    // Ensure we have a thread
    if (!this.state.threadId) {
      await this.createThread();
    }

    // Try to connect to Stitch MCP
    await this.connectToStitch();

    // Create user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMessage,
      createdAt: Date.now(),
    };

    // Add to history and persist
    const updatedHistory = [...this.state.conversationHistory, userMsg];
    this.setState({ ...this.state, conversationHistory: updatedHistory });
    this.persistMessage(userMsg);

    // Build messages for OpenAI
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.state.systemPrompt },
      ...updatedHistory.map((msg) => {
        if (msg.role === "tool" && msg.toolCallId) {
          return {
            role: "tool" as const,
            content: msg.content,
            tool_call_id: msg.toolCallId,
          };
        }
        if (msg.role === "assistant" && msg.toolCalls) {
          return {
            role: "assistant" as const,
            content: msg.content,
            tool_calls: msg.toolCalls,
          };
        }
        return {
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        };
      }),
    ];

    // Get available MCP tools
    const tools = this.getMcpTools();

    // Call OpenAI
    const openai = this.getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    });

    const assistantMessage = completion.choices[0].message;
    let responseContent = assistantMessage.content || "";

    // Handle tool calls if present
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Store assistant message with tool calls
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: responseContent,
        toolCalls: assistantMessage.tool_calls,
        createdAt: Date.now(),
      };
      
      const historyWithAssistant = [...this.state.conversationHistory, assistantMsg];
      this.setState({ ...this.state, conversationHistory: historyWithAssistant });
      this.persistMessage(assistantMsg);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        try {
          // For MCP tools, we would execute via MCP client
          // This is a placeholder for tool execution
          const toolResult = await this.executeMcpTool(
            toolCall.function.name,
            JSON.parse(toolCall.function.arguments)
          );

          const toolMsg: Message = {
            id: crypto.randomUUID(),
            role: "tool",
            content: JSON.stringify(toolResult),
            toolCallId: toolCall.id,
            createdAt: Date.now(),
          };

          const historyWithTool = [...this.state.conversationHistory, toolMsg];
          this.setState({ ...this.state, conversationHistory: historyWithTool });
          this.persistMessage(toolMsg);
        } catch (error) {
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "tool",
            content: JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" }),
            toolCallId: toolCall.id,
            createdAt: Date.now(),
          };

          const historyWithError = [...this.state.conversationHistory, errorMsg];
          this.setState({ ...this.state, conversationHistory: historyWithError });
          this.persistMessage(errorMsg);
        }
      }

      // Get final response after tool calls
      const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: this.state.systemPrompt },
        ...this.state.conversationHistory.map((msg) => {
          if (msg.role === "tool" && msg.toolCallId) {
            return {
              role: "tool" as const,
              content: msg.content,
              tool_call_id: msg.toolCallId,
            };
          }
          if (msg.role === "assistant" && msg.toolCalls) {
            return {
              role: "assistant" as const,
              content: msg.content,
              tool_calls: msg.toolCalls,
            };
          }
          return {
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
          };
        }),
      ];

      const followUpCompletion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: followUpMessages,
      });

      responseContent = followUpCompletion.choices[0].message.content || "";
    }

    // Store final assistant response
    const finalAssistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: responseContent,
      createdAt: Date.now(),
    };

    const finalHistory = [...this.state.conversationHistory, finalAssistantMsg];
    this.setState({ ...this.state, conversationHistory: finalHistory });
    this.persistMessage(finalAssistantMsg);

    return {
      response: responseContent,
      threadId: this.state.threadId!,
    };
  }

  /**
   * Execute an MCP tool
   */
  private async executeMcpTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Get MCP servers and find the one with this tool
    const mcpServers = this.getMcpServers() as unknown as Record<string, MCPServerInfo> | undefined;

    if (!mcpServers || typeof mcpServers !== "object") {
      throw new Error(`Tool not found: ${toolName}`);
    }

    for (const [, server] of Object.entries(mcpServers)) {
      if (server && server.state === "ready" && server.tools) {
        const tool = server.tools.find((t: { name: string }) => t.name === toolName);
        if (tool && server.client) {
          // Execute the tool using the MCP client
          const result = await server.client.callTool({
            name: toolName,
            arguments: args,
          });
          return result;
        }
      }
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * Handle WebSocket connections for real-time chat
   */
  async onConnect(connection: unknown): Promise<void> {
    console.log("Client connected to UX Architect Agent");
    await this.connectToStitch();
  }

  /**
   * Handle incoming WebSocket messages
   */
  async onMessage(
    connection: unknown,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") {
      return;
    }

    try {
      const data = JSON.parse(message);

      if (data.type === "chat" && data.message) {
        const result = await this.chat(data.message);
        // Response will be sent via state sync
        console.log("Chat response:", result.response.substring(0, 100));
      } else if (data.type === "create_thread") {
        const threadId = await this.createThread(data.title);
        console.log("Created thread:", threadId);
      } else if (data.type === "load_thread" && data.threadId) {
        await this.loadThread(data.threadId);
      } else if (data.type === "list_threads") {
        const threads = await this.listThreads();
        console.log("Listed threads:", threads.length);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  /**
   * Handle HTTP requests directly to the agent
   */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle thread creation
    if (path === "/threads" && request.method === "POST") {
      const body = await request.json() as { title?: string };
      const threadId = await this.createThread(body.title);
      return Response.json({ threadId });
    }

    // Handle thread listing
    if (path === "/threads" && request.method === "GET") {
      const threads = await this.listThreads();
      return Response.json({ threads });
    }

    // Handle chat
    if (path === "/chat" && request.method === "POST") {
      const body = await request.json() as { message: string; threadId?: string };
      
      if (body.threadId) {
        await this.loadThread(body.threadId);
      }

      const result = await this.chat(body.message);
      return Response.json(result);
    }

    // Handle thread loading
    if (path.startsWith("/threads/") && request.method === "GET") {
      const threadId = path.replace("/threads/", "");
      const loaded = await this.loadThread(threadId);
      
      if (!loaded) {
        return Response.json({ error: "Thread not found" }, { status: 404 });
      }

      return Response.json({
        threadId,
        messages: this.state.conversationHistory,
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}
