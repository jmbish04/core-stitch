-- D1 Schema for threads and messages persistence

-- Threads table to store conversation threads
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT -- JSON field for additional thread metadata
);

-- Messages table to store individual messages within threads
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT, -- JSON array of tool calls if applicable
  tool_call_id TEXT, -- For tool response messages
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  metadata TEXT, -- JSON field for additional message metadata
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Index for efficient thread message lookup
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);

-- Index for chronological message ordering
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Index for thread ordering
CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
