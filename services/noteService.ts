import * as db from '../db/queries';
import { generateNoteEmbedding } from '../ai/embeddings';
import type { Note, CreateNoteInput, UpdateNoteInput, SearchResult } from '../types';

export async function listNotes(userId: string): Promise<Note[]> {
  return db.getNotesByUser(userId);
}

export async function getNote(id: string): Promise<Note | null> {
  return db.getNoteById(id);
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const note = await db.createNote(input);

  try {
    const embedding = await generateNoteEmbedding(note.title, note.content);
    await db.upsertEmbedding(note.id, embedding);
  } catch (err) {
    console.warn(`Embedding generation failed for note ${note.id}:`, err);
  }

  return note;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  const note = await db.updateNote(id, input);

  try {
    const embedding = await generateNoteEmbedding(note.title, note.content);
    await db.upsertEmbedding(note.id, embedding);
  } catch (err) {
    console.warn(`Embedding update failed for note ${note.id}:`, err);
  }

  return note;
}

export async function deleteNote(id: string): Promise<void> {
  return db.deleteNote(id);
}

export async function searchByText(userId: string, query: string): Promise<Note[]> {
  return db.searchNotesByText(userId, query);
}

export async function searchBySemantic(
  userId: string,
  query: string,
  matchThreshold?: number,
  matchCount?: number
): Promise<SearchResult[]> {
  const embedding = await generateNoteEmbedding(query, '');
  return db.searchNotesBySimilarity(embedding, userId, matchThreshold, matchCount);
}
