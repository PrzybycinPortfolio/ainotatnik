import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';
import { generateEmbedding } from '../lib/gemini';

const inputSchema = z.object({
  problem_description: z.string().min(1).max(1000),
  match_count: z.number().int().positive().max(15).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface LegalArticle {
  legal_chunk_id: string;
  act_name: string;
  article_number: string | null;
  content: string;
  legal_status_date: string;
  similarity: number;
}

interface Output {
  articles: LegalArticle[];
  disclaimer: string;
}

// Legal acts are shared reference data (legal_acts/legal_chunks have no
// user_id), so this search is not scoped to the caller the way notes/invoices
// are — it runs against whatever acts the app owner has ingested for everyone.
export const legalSearchTool: Tool<Input, Output> = {
  name: 'find_applicable_articles',
  description:
    "Search the ingested legal acts (codes/statutes) for articles that may apply to a described legal problem, written in plain language. Returns the exact article text and the date it is current as of. This is a research aid, not legal advice — the response to the user must say so explicitly and must not cite any article not returned by this tool.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      problem_description: { type: SchemaType.STRING, description: "Plain-language description of the user's legal problem" },
      match_count: { type: SchemaType.NUMBER, description: 'Max articles to return (default 8, max 15)' },
    },
    required: ['problem_description'],
  },
  async execute(input, ctx) {
    const embedding = await generateEmbedding(ctx.geminiApiKey, input.problem_description);
    const { data, error } = await ctx.supabase.rpc('search_legal_chunks_by_embedding', {
      query_embedding: embedding,
      match_threshold: 0.6,
      match_count: input.match_count ?? 8,
    });

    if (error) throw new Error(`find_applicable_articles: ${error.message}`);

    return {
      articles: data ?? [],
      disclaimer:
        'To narzędzie pomocnicze do wstępnej orientacji, nie zastępuje porady prawnika. Zweryfikuj poniższe z profesjonalistą przed podjęciem działań.',
    };
  },
};
