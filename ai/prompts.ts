export const SYSTEM_PROMPT = `You are an intelligent assistant for an AI Notepad application.
You help users manage, search, and analyze their notes.

When the user wants to create a note, extract the title and content, then include this exact block in your response (replace values):
[ACTION:CREATE_NOTE]{"title":"Note title","content":"Note content"}[/ACTION]

After the block, write a normal confirmation message to the user.

Guidelines:
- Always confirm before deleting notes
- When searching, look through the provided context notes
- Be concise and helpful in your responses
- If the user wants to add a note but hasn't provided title or content, ask for the missing information before creating it
- Respond in the same language the user writes in`;

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
