import { z } from 'zod';
import { createNote, updateNote, deleteNote } from '../../services/noteService';

export const addNoteSchema = {
  user_id: z.string().describe('User ID'),
  title: z.string().describe('Note title'),
  content: z.string().describe('Note content'),
};

export async function addNoteTool(args: {
  user_id: string;
  title: string;
  content: string;
}): Promise<string> {
  const note = await createNote({
    user_id: args.user_id,
    title: args.title,
    content: args.content,
  });
  return `Note created successfully.\nID: ${note.id}\nTitle: ${note.title}`;
}

export const updateNoteSchema = {
  id: z.string().describe('Note ID to update'),
  title: z.string().optional().describe('New title'),
  content: z.string().optional().describe('New content'),
};

export async function updateNoteTool(args: {
  id: string;
  title?: string;
  content?: string;
}): Promise<string> {
  const { id, ...input } = args;
  const note = await updateNote(id, input);
  return `Note updated successfully.\nID: ${note.id}\nTitle: ${note.title}`;
}

export const deleteNoteSchema = {
  id: z.string().describe('Note ID to delete'),
};

export async function deleteNoteTool(args: { id: string }): Promise<string> {
  await deleteNote(args.id);
  return `Note ${args.id} deleted successfully.`;
}
