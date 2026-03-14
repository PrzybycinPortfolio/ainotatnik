import { z } from 'zod';
import { listNotes, getNote } from '../../services/noteService';
import { generateText } from '../../ai/gemini';
import { buildSummarizePrompt } from '../../ai/prompts';

export const summarizeNotesSchema = {
  user_id: z.string().describe('User ID'),
  note_ids: z
    .array(z.string())
    .optional()
    .describe('Specific note IDs to summarize. If omitted, summarizes all notes.'),
};

export async function summarizeNotesTool(args: {
  user_id: string;
  note_ids?: string[];
}): Promise<string> {
  let notes;

  if (args.note_ids && args.note_ids.length > 0) {
    const fetched = await Promise.all(args.note_ids.map((id) => getNote(id)));
    notes = fetched.filter((n): n is NonNullable<typeof n> => n !== null);
  } else {
    notes = await listNotes(args.user_id);
  }

  if (notes.length === 0) return 'No notes to summarize.';

  const prompt = buildSummarizePrompt(notes);
  const summary = await generateText(prompt);

  return `Summary of ${notes.length} note(s):\n\n${summary}`;
}
