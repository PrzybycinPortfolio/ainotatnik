import { z } from 'zod';
import { searchByText, listNotes } from '../../services/noteService';
import type { Note } from '../../types';

export const searchNotesSchema = {
  user_id: z.string().describe('User ID'),
  query: z.string().describe('Search keyword or phrase'),
};

function formatNotes(notes: Note[]): string {
  if (notes.length === 0) return 'No notes found.';
  return notes
    .map((n, i) => `[${i + 1}] ${n.title} (id: ${n.id})\n${n.content.slice(0, 200)}${n.content.length > 200 ? '...' : ''}`)
    .join('\n\n');
}

export async function searchNotesTool(args: { user_id: string; query: string }): Promise<string> {
  const notes = await searchByText(args.user_id, args.query);
  return `Found ${notes.length} note(s):\n\n${formatNotes(notes)}`;
}

export const listNotesSchema = {
  user_id: z.string().describe('User ID'),
};

export async function listNotesTool(args: { user_id: string }): Promise<string> {
  const notes = await listNotes(args.user_id);
  return `You have ${notes.length} note(s):\n\n${formatNotes(notes)}`;
}
