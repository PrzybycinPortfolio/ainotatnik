export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'model';
  content: string;
  created_at: string;
}

export interface Embedding {
  id: string;
  note_id: string;
  embedding: number[];
  created_at: string;
}

export interface SearchResult extends Note {
  similarity?: number;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  user_id: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
}
