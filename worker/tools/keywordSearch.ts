import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';
import { escapeLikeValue } from '../lib/text';

const inputSchema = z.object({
  query: z.string().min(1).max(200),
});

type Input = z.infer<typeof inputSchema>;
interface Output {
  results: { title: string; content: string }[];
}

export const keywordSearchTool: Tool<Input, Output> = {
  name: 'keyword_search_notes',
  description:
    "Search the user's notes for an exact word or phrase in the title or content. Use this when the user names something specific (a proper noun, an exact term, an ID) rather than asking a broad question.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: { type: SchemaType.STRING, description: 'Exact keyword or phrase to search for' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    const safeQuery = escapeLikeValue(input.query);
    const { data, error } = await ctx.supabase
      .from('notes')
      .select('title, content')
      .or(`title.ilike.%${safeQuery}%,content.ilike.%${safeQuery}%`)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(`keyword_search_notes: ${error.message}`);
    return { results: data ?? [] };
  },
};
