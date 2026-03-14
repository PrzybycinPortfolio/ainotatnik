import { z } from 'zod';
import { searchBySemantic } from '../../services/noteService';
import type { SearchResult } from '../../types';

export const semanticSearchSchema = {
  user_id: z.string().describe('User ID'),
  query: z.string().describe('Natural language query to search by meaning'),
  match_threshold: z.number().min(0).max(1).optional().describe('Similarity threshold (0-1), default 0.7'),
  match_count: z.number().int().positive().optional().describe('Maximum number of results, default 10'),
};

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No semantically similar notes found.';
  return results
    .map((n, i) => {
      const similarity = n.similarity != null ? ` (similarity: ${(n.similarity * 100).toFixed(1)}%)` : '';
      return `[${i + 1}] ${n.title}${similarity} (id: ${n.id})\n${n.content.slice(0, 200)}${n.content.length > 200 ? '...' : ''}`;
    })
    .join('\n\n');
}

export async function semanticSearchTool(args: {
  user_id: string;
  query: string;
  match_threshold?: number;
  match_count?: number;
}): Promise<string> {
  const results = await searchBySemantic(
    args.user_id,
    args.query,
    args.match_threshold,
    args.match_count
  );
  return `Found ${results.length} semantically relevant note(s):\n\n${formatResults(results)}`;
}
