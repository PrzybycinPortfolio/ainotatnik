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

// ── Note management ───────────────────────────────────────────────────────────

server.registerTool(
  'add_note',
  {
    description: 'Create a new note for the user',
    inputSchema: {
      user_id: z.string().describe('User ID'),
      title: z.string().describe('Note title'),
      content: z.string().describe('Note content'),
    },
  },
  async (args) => {
    const text = await addNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

server.registerTool(
  'update_note',
  {
    description: 'Edit an existing note',
    inputSchema: {
      id: z.string().describe('Note ID to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
    },
  },
  async (args) => {
    const text = await updateNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

server.registerTool(
  'delete_note',
  {
    description: 'Delete a note by ID',
    inputSchema: {
      id: z.string().describe('Note ID to delete'),
    },
  },
  async (args) => {
    const text = await deleteNoteTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

// ── Search ────────────────────────────────────────────────────────────────────

server.registerTool(
  'list_notes',
  {
    description: 'List all notes for a user',
    inputSchema: {
      user_id: z.string().describe('User ID'),
    },
  },
  async (args) => {
    const text = await listNotesTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

server.registerTool(
  'search_notes',
  {
    description: 'Search notes by keyword in title or content',
    inputSchema: {
      user_id: z.string().describe('User ID'),
      query: z.string().describe('Search keyword or phrase'),
    },
  },
  async (args) => {
    const text = await searchNotesTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

server.registerTool(
  'semantic_search',
  {
    description: 'Find notes by meaning using vector similarity search',
    inputSchema: {
      user_id: z.string().describe('User ID'),
      query: z.string().describe('Natural language query'),
      match_threshold: z.number().min(0).max(1).optional().describe('Similarity threshold (0-1)'),
      match_count: z.number().int().positive().optional().describe('Max number of results'),
    },
  },
  async (args) => {
    const text = await semanticSearchTool(args);
    return { content: [{ type: 'text', text }] };
  }
);

// ── AI analysis ───────────────────────────────────────────────────────────────

server.registerTool(
  'summarize_notes',
  {
    description: 'Generate an AI summary of notes',
    inputSchema: {
      user_id: z.string().describe('User ID'),
      note_ids: z.array(z.string()).optional().describe('Specific note IDs to summarize. If omitted, summarizes all notes.'),
    },
  },
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
