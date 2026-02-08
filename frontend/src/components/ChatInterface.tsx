import React, { useState, useEffect, useCallback } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  Thread,
} from "@assistant-ui/react";
import type {
  ThreadMessageLike,
  AppendMessage,
} from "@assistant-ui/react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Plus,
  Menu,
  Trash2,
  ChevronLeft,
  Sparkles,
} from "lucide-react";

// Types for our API responses
interface ApiThread {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface ApiMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: number;
  metadata: string | null;
}

interface ChatState {
  threads: ApiThread[];
  currentThreadId: string | null;
  messages: ThreadMessageLike[];
  isLoading: boolean;
}

// API client for the Worker
const api = {
  baseUrl: "/api",

  async getThreads(): Promise<ApiThread[]> {
    const response = await fetch(`${this.baseUrl}/threads`);
    const data = await response.json();
    return data.threads || [];
  },

  async createThread(title?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await response.json();
    return data.threadId;
  },

  async getThread(
    threadId: string
  ): Promise<{ thread: ApiThread; messages: ApiMessage[] }> {
    const response = await fetch(`${this.baseUrl}/threads/${threadId}`);
    return response.json();
  },

  async deleteThread(threadId: string): Promise<void> {
    await fetch(`${this.baseUrl}/threads/${threadId}`, {
      method: "DELETE",
    });
  },

  async chat(
    message: string,
    threadId?: string
  ): Promise<{ response: string; threadId: string }> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, threadId }),
    });
    return response.json();
  },
};

// Sidebar component for thread history
interface SidebarProps {
  threads: ApiThread[];
  currentThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onDeleteThread: (threadId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function Sidebar({
  threads,
  currentThreadId,
  onSelectThread,
  onCreateThread,
  onDeleteThread,
  isOpen,
  onToggle,
}: SidebarProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r bg-card transition-transform duration-300",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">UX Architect</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="lg:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="p-4">
          <Button onClick={onCreateThread} className="w-full gap-2">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        <Separator />

        {/* Thread List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {threads.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                No conversations yet
              </p>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                    thread.id === currentThreadId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted"
                  )}
                  onClick={() => onSelectThread(thread.id)}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 truncate">
                    <p className="truncate font-medium">
                      {thread.title || "New conversation"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(thread.updated_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(thread.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <Separator />
        <div className="p-4">
          <p className="text-xs text-muted-foreground text-center">
            Powered by Cloudflare Agents SDK
          </p>
        </div>
      </aside>
    </>
  );
}

// Main chat interface component
export default function ChatInterface() {
  const [state, setState] = useState<ChatState>({
    threads: [],
    currentThreadId: null,
    messages: [],
    isLoading: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load threads on mount
  useEffect(() => {
    const loadThreads = async () => {
      try {
        const threads = await api.getThreads();
        setState((prev) => ({ ...prev, threads }));
      } catch (error) {
        console.error("Failed to load threads:", error);
      }
    };
    loadThreads();
  }, []);

  // Load messages when thread changes
  useEffect(() => {
    if (!state.currentThreadId) {
      setState((prev) => ({ ...prev, messages: [] }));
      return;
    }

    const loadMessages = async () => {
      try {
        const { messages: apiMessages } = await api.getThread(
          state.currentThreadId!
        );
        const messages: ThreadMessageLike[] = apiMessages
          .filter((msg) => msg.role === "user" || msg.role === "assistant")
          .map((msg) => ({
            id: msg.id,
            role: msg.role as "user" | "assistant",
            content: [{ type: "text" as const, text: msg.content }],
            createdAt: new Date(msg.created_at * 1000),
          }));
        setState((prev) => ({ ...prev, messages }));
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    };
    loadMessages();
  }, [state.currentThreadId]);

  // Handle selecting a thread
  const handleSelectThread = useCallback((threadId: string) => {
    setState((prev) => ({ ...prev, currentThreadId: threadId }));
    setSidebarOpen(false);
  }, []);

  // Handle creating a new thread
  const handleCreateThread = useCallback(async () => {
    try {
      const threadId = await api.createThread();
      setState((prev) => ({
        ...prev,
        currentThreadId: threadId,
        messages: [],
        threads: [
          {
            id: threadId,
            title: null,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            metadata: null,
          },
          ...prev.threads,
        ],
      }));
      setSidebarOpen(false);
    } catch (error) {
      console.error("Failed to create thread:", error);
    }
  }, []);

  // Handle deleting a thread
  const handleDeleteThread = useCallback(async (threadId: string) => {
    try {
      await api.deleteThread(threadId);
      setState((prev) => ({
        ...prev,
        threads: prev.threads.filter((t) => t.id !== threadId),
        currentThreadId:
          prev.currentThreadId === threadId ? null : prev.currentThreadId,
        messages: prev.currentThreadId === threadId ? [] : prev.messages,
      }));
    } catch (error) {
      console.error("Failed to delete thread:", error);
    }
  }, []);

  // Handle sending a message
  const handleAppend = useCallback(
    async (message: AppendMessage) => {
      const textContent = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");

      if (!textContent.trim()) return;

      const userMessage: ThreadMessageLike = {
        id: crypto.randomUUID(),
        role: "user",
        content: [{ type: "text", text: textContent }],
        createdAt: new Date(),
      };

      // Optimistically add user message and set loading state
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isLoading: true,
      }));

      try {
        const result = await api.chat(textContent, state.currentThreadId || undefined);

        const assistantMessage: ThreadMessageLike = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: [{ type: "text", text: result.response }],
          createdAt: new Date(),
        };

        // Update state with assistant response
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
          currentThreadId: result.threadId,
          isLoading: false,
        }));

        // Refresh threads list to get updated timestamp
        const threads = await api.getThreads();
        setState((prev) => ({ ...prev, threads }));
      } catch (error) {
        console.error("Failed to send message:", error);
        // On error, remove the optimistic message and reset loading state
        setState((prev) => ({
          ...prev,
          isLoading: false,
          messages: prev.messages.filter((m) => m.id !== userMessage.id),
        }));
      }
    },
    [state.currentThreadId]
  );

  // Create external store runtime
  const runtime = useExternalStoreRuntime({
    messages: state.messages,
    isRunning: state.isLoading,
    onNew: handleAppend,
    convertMessage: (message: ThreadMessageLike) => message,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full">
        {/* Sidebar */}
        <Sidebar
          threads={state.threads}
          currentThreadId={state.currentThreadId}
          onSelectThread={handleSelectThread}
          onCreateThread={handleCreateThread}
          onDeleteThread={handleDeleteThread}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col h-full">
          {/* Header */}
          <header className="flex h-16 items-center gap-4 border-b px-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h2 className="font-semibold">
                {state.currentThreadId
                  ? state.threads.find((t) => t.id === state.currentThreadId)
                      ?.title || "Conversation"
                  : "New Conversation"}
              </h2>
              <p className="text-sm text-muted-foreground">
                AI-powered UX Architect ready to help with your design needs
              </p>
            </div>
          </header>

          {/* Chat area */}
          <div className="flex-1 overflow-hidden">
            <Thread />
          </div>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
