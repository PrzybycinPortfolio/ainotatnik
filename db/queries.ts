import { supabase } from '../config/supabase';
import type { Note, Conversation, Message, CreateNoteInput, UpdateNoteInput, SearchResult } from '../types';

// ── Notes ────────────────────────────────────────────────────────────────────

export async function getNotesByUser(userId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`getNotesByUser: ${error.message}`);
  return data ?? [];
}

export async function getNoteById(id: string): Promise<Note | null> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(`createNote: ${error.message}`);
  return data;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`updateNote: ${error.message}`);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`deleteNote: ${error.message}`);
}

export async function searchNotesByText(userId: string, query: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`searchNotesByText: ${error.message}`);
  return data ?? [];
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function upsertEmbedding(noteId: string, embedding: number[]): Promise<void> {
  const { error } = await supabase
    .from('embeddings')
    .upsert({ note_id: noteId, embedding: JSON.stringify(embedding) }, { onConflict: 'note_id' });

  if (error) throw new Error(`upsertEmbedding: ${error.message}`);
}

export async function searchNotesBySimilarity(
  queryEmbedding: number[],
  userId: string,
  matchThreshold = 0.7,
  matchCount = 10
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_notes_by_embedding', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_user_id: userId,
  });

  if (error) throw new Error(`searchNotesBySimilarity: ${error.message}`);
  return data ?? [];
}

export async function getNotesWithoutEmbeddings(userId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*, embeddings!left(id)')
    .eq('user_id', userId)
    .is('embeddings.id', null);

  if (error) throw new Error(`getNotesWithoutEmbeddings: ${error.message}`);
  return data ?? [];
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function createConversation(userId: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select()
    .single();

  if (error) throw new Error(`createConversation: ${error.message}`);
  return data;
}

export async function getConversationsByUser(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`getConversationsByUser: ${error.message}`);
  return data ?? [];
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function addMessage(
  conversationId: string,
  role: 'user' | 'model',
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single();

  if (error) throw new Error(`addMessage: ${error.message}`);
  return data;
}

export async function getMessagesByConversation(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getMessagesByConversation: ${error.message}`);
  return data ?? [];
}
