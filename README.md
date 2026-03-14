# AI Notatnik

An AI-powered note-taking application with semantic search, built on **Gemini**, **Supabase**, and the **Model Context Protocol (MCP)**. Notes are stored in PostgreSQL, enriched with vector embeddings, and queryable through natural language via an MCP server that any MCP-compatible client (e.g. Claude Desktop) can connect to.

---

## Features

- **Note management** — create, edit, delete, and list notes
- **Full-text search** — keyword search across titles and content
- **Semantic search** — vector similarity search using Gemini embeddings (`text-embedding-004`)
- **AI summarization** — generate summaries of one or all notes using Gemini 2.0 Flash
- **Conversational AI** — chat with an AI that retrieves relevant notes as context
- **Conversation history** — all messages persisted per user
- **Row Level Security** — each user can only access their own data
- **LangSmith tracing** — optional observability for all LLM calls

---

## Architecture

```
MCP Client (e.g. Claude Desktop)
        │
        ▼
   MCP Server  ──────────────────────────────────┐
  (stdio transport)                              │
        │                                        │
        ▼                                        ▼
  Gemini 2.0 Flash                    Supabase (PostgreSQL)
  text-embedding-004                  ├── notes
                                      ├── embeddings (pgvector)
                                      ├── conversations
                                      └── messages
```

**Data flow:**
1. MCP client calls a tool (e.g. `semantic_search`)
2. MCP server validates input with Zod and calls the appropriate service
3. Service queries Supabase or calls Gemini
4. Result is returned to the MCP client as text content

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| AI model | Google Gemini 2.0 Flash |
| Embeddings | Gemini text-embedding-004 (768 dimensions) |
| Database | PostgreSQL via Supabase |
| Vector search | pgvector |
| AI protocol | Model Context Protocol (MCP) SDK v1 |
| Schema validation | Zod |
| Observability | LangSmith (optional) |

---

## Project Structure

```
├── index.ts                        # Interactive CLI chat entry point
├── langsmithLogger.ts              # LangSmith tracing wrapper
├── types/
│   └── index.ts                    # Shared TypeScript interfaces
├── config/
│   └── supabase.ts                 # Supabase client
├── db/
│   └── queries.ts                  # Raw database queries (CRUD + RPC)
├── ai/
│   ├── gemini.ts                   # Gemini chat + text generation
│   ├── embeddings.ts               # Vector embedding generation
│   └── prompts.ts                  # System prompt + context builders
├── services/
│   ├── noteService.ts              # Note business logic
│   ├── conversationService.ts      # Chat + conversation management
│   └── embeddingService.ts         # Bulk embedding utilities
├── mcp/
│   ├── server.ts                   # MCP server (registerTool)
│   └── tools/
│       ├── addNotes.ts             # create / update / delete tools
│       ├── searchNotes.ts          # text search + list tools
│       ├── semanticSearch.ts       # vector similarity search tool
│       └── summarizeNotes.ts       # AI summarization tool
├── scripts/
│   └── generateEmbeddings.ts       # One-off bulk embedding script
└── supabase/
    ├── migrations/schema.sql        # Full DB schema with RLS + pgvector
    └── seed.sql                     # Example seed data
```

---

## Database Schema

```sql
notes          — id, user_id, title, content, created_at, updated_at
conversations  — id, user_id, created_at
messages       — id, conversation_id, role ('user'|'model'), content, created_at
embeddings     — id, note_id, embedding vector(768), created_at
```

All tables have **Row Level Security** enabled — users can only read and write their own rows. Vector similarity search is handled by a custom SQL function `search_notes_by_embedding` using the `<=>` cosine distance operator.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project with the `vector` extension enabled
- A [Google AI Studio](https://aistudio.google.com) API key (Gemini)

### 1. Clone and install

```bash
git clone <repo-url>
cd ai-notatnik
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
GEMINI_API_KEY=your-gemini-api-key

# Optional
LANGSMITH_API_KEY=your-langsmith-key
DEFAULT_USER_ID=your-user-uuid
```

### 3. Apply the database schema

Open the Supabase SQL editor and run:

```bash
supabase/migrations/schema.sql
```

This creates all tables, RLS policies, the pgvector index, and the `search_notes_by_embedding` function.

### 4. Run

**As an MCP server** (connect via Claude Desktop or another MCP client):

```bash
npm run mcp
```

**As an interactive CLI chat:**

```bash
npm run dev
```

**Generate embeddings for existing notes** (run once after importing notes):

```bash
npm run generate-embeddings <user-id>
```

---

## MCP Tools

The server exposes 7 tools to MCP clients:

| Tool | Description |
|---|---|
| `add_note` | Create a new note |
| `update_note` | Edit title or content of an existing note |
| `delete_note` | Delete a note by ID |
| `list_notes` | List all notes for a user |
| `search_notes` | Keyword search across title and content |
| `semantic_search` | Find notes by meaning using vector similarity |
| `summarize_notes` | Generate an AI summary of selected or all notes |

### Claude Desktop configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-notatnik": {
      "command": "npx",
      "args": ["ts-node", "/absolute/path/to/mcp/server.ts"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_ANON_KEY": "...",
        "GEMINI_API_KEY": "..."
      }
    }
  }
}
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start interactive CLI chat |
| `npm run mcp` | Start MCP server on stdio |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting (uses 8 GB heap due to MCP SDK type complexity) |
| `npm run generate-embeddings` | Generate missing embeddings for all notes |

---

## Observability

If `LANGSMITH_API_KEY` is set, the following calls are automatically traced in LangSmith:

- `gemini.generateResponse` — chat completions
- `gemini.generateText` — one-shot text generation (used for summaries)
- `createNote` / `updateNote` — note writes with embedding generation
- `searchBySemantic` — vector search queries
- `chat` — full conversation turns including context retrieval

---

## Future Improvements

- Web interface (React / Next.js)
- Document import (PDF, Markdown)
- Tag and category system
- Multi-workspace support
- Calendar integration
- Full Supabase Auth integration
