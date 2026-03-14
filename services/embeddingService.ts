import * as db from '../db/queries';
import { generateNoteEmbedding } from '../ai/embeddings';

export async function generateMissingEmbeddings(userId: string): Promise<number> {
  const notes = await db.getNotesWithoutEmbeddings(userId);

  let count = 0;
  for (const note of notes) {
    try {
      const embedding = await generateNoteEmbedding(note.title, note.content);
      await db.upsertEmbedding(note.id, embedding);
      count++;
      console.log(`Generated embedding for note: "${note.title}"`);
    } catch (err) {
      console.error(`Failed for note ${note.id}:`, err);
    }
  }

  return count;
}

export async function regenerateEmbedding(noteId: string, title: string, content: string): Promise<void> {
  const embedding = await generateNoteEmbedding(title, content);
  await db.upsertEmbedding(noteId, embedding);
}
