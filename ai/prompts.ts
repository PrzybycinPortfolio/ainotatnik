export const SYSTEM_PROMPT = `You are an intelligent assistant for an AI Notepad application.
You help users manage, search, and analyze their notes.

You have access to the following tools:
- search_notes: Search notes by keyword
- semantic_search: Find notes by meaning/context using vector search
- add_note: Create a new note
- update_note: Edit an existing note
- delete_note: Remove a note
- summarize_notes: Generate a summary of selected notes

Guidelines:
- Always confirm before deleting notes
- When searching, try semantic_search for conceptual queries and search_notes for exact keywords
- Be concise and helpful in your responses
- When adding notes, ask for title and content if not provided`;

export function buildContextPrompt(notes: { title: string; content: string }[]): string {
  if (notes.length === 0) return '';

  const notesText = notes
    .map((n, i) => `[Note ${i + 1}] ${n.title}\n${n.content}`)
    .join('\n\n---\n\n');

  return `\n\nRelevant notes from the user's notepad:\n\n${notesText}`;
}

export function buildSummarizePrompt(notes: { title: string; content: string }[]): string {
  const notesText = notes
    .map((n, i) => `[${i + 1}] ${n.title}\n${n.content}`)
    .join('\n\n---\n\n');

  return `Summarize the following notes concisely, highlighting key points and themes:\n\n${notesText}`;
}
