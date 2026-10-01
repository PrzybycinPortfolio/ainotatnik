import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';
import { generateEmbedding } from '../lib/gemini';

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  match_count: z.number().int().positive().max(20).optional(),
});

type Input = z.infer<typeof inputSchema>;
interface Output {
  results: { title: string; content: string; similarity: number }[];
}

export const semanticSearchTool: Tool<Input, Output> = {
  name: 'semantic_search_notes',
  description:
    "Search the user's notes by meaning rather than exact wording, and return the most relevant ones with a similarity score. Use this when the question is broad or descriptive and the answer likely lives in one of the user's own notes.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Natural language search query' },
      match_count: { type: SchemaType.NUMBER, description: 'Max results to return (default 5, max 20)' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    const embedding = await generateEmbedding(ctx.geminiApiKey, input.query);
    const { data, error } = await ctx.supabase.rpc('search_notes_by_embedding', {
      query_embedding: embedding,
      match_threshold: 0.6,
      match_count: input.match_count ?? 5,
      p_user_id: ctx.userId,
    });

    if (error) throw new Error(`semantic_search_notes: ${error.message}`);

    const rows = (data ?? []) as { title: string; content: string; similarity: number }[];
    return { results: rows.map((r) => ({ title: r.title, content: r.content, similarity: r.similarity })) };
  },
};
