import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as dotenv from 'dotenv';

import { addNoteTool, updateNoteTool, deleteNoteTool } from './tools/addNotes';
import { searchNotesTool, listNotesTool } from './tools/searchNotes';
import { semanticSearchTool } from './tools/semanticSearch';
import { summarizeNotesTool } from './tools/summarizeNotes';

dotenv.config();

const server = new McpServer({
  name: 'ai-notatnik',
  version: '1.0.0',
});

// Helper that provides a clean API while isolating TS2589 caused by MCP SDK's
// deep conditional types in registerTool<AnySchema>.
function defineTool<T extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<T>) => Promise<{ content: { type: 'text'; text: string }[] }>
): void {
  // @ts-expect-error TS2589 – registerTool's ToolCallback<AnySchema> conditional type
  // causes excessively deep instantiation; runtime behaviour is correct.
  server.registerTool(name, { description, inputSchema }, handler);
}

// ── Note management ───────────────────────────────────────────────────────────

defineTool(
  'add_note',
  'Create a new note for the user',
  z.object({
    user_id: z.string().describe('User ID'),
    title: z.string().describe('Note title'),
    content: z.string().describe('Note content'),
  }),
  async (args) => {
    const text = await addNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

defineTool(
  'update_note',
  'Edit an existing note',
  z.object({
    id: z.string().describe('Note ID to update'),
    title: z.string().optional().describe('New title'),
    content: z.string().optional().describe('New content'),
  }),
  async (args) => {
    const text = await updateNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

defineTool(
  'delete_note',
  'Delete a note by ID',
  z.object({
    id: z.string().describe('Note ID to delete'),
  }),
  async (args) => {
    const text = await deleteNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

// ── Search ────────────────────────────────────────────────────────────────────

defineTool(
  'list_notes',
  'List all notes for a user',
  z.object({
    user_id: z.string().describe('User ID'),
  }),
  async (args) => {
    const text = await listNotesTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

defineTool(
  'search_notes',
  'Search notes by keyword in title or content',
  z.object({
    user_id: z.string().describe('User ID'),
    query: z.string().describe('Search keyword or phrase'),
  }),
  async (args) => {
    const text = await searchNotesTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

defineTool(
  'semantic_search',
  'Find notes by meaning using vector similarity search',
  z.object({
    user_id: z.string().describe('User ID'),
    query: z.string().describe('Natural language query'),
    match_threshold: z.number().min(0).max(1).optional().describe('Similarity threshold (0-1)'),
    match_count: z.number().int().positive().optional().describe('Max number of results'),
  }),
  async (args) => {
    const text = await semanticSearchTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

// ── AI analysis ───────────────────────────────────────────────────────────────

defineTool(
  'summarize_notes',
  'Generate an AI summary of notes',
  z.object({
    user_id: z.string().describe('User ID'),
    note_ids: z.array(z.string()).optional().describe('Specific note IDs to summarize. If omitted, summarizes all.'),
  }),
  async (args) => {
    const text = await summarizeNotesTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AI Notatnik MCP server running on stdio');
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});
