import { GoogleGenerativeAI, type ChatSession, type Content, type FunctionDeclaration } from '@google/generative-ai';
import { SYSTEM_PROMPT } from '../../ai/prompts';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const CHAT_MODEL = 'gemini-2.5-pro';
const EMBEDDING_DIMENSIONS = 768;

// Clients are created per call (not at module scope) because Workers only
// expose bindings/secrets through the request's `env`, not as module-load globals.
export async function generateEmbedding(apiKey: string, text: string): Promise<number[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: EMBEDDING_DIMENSIONS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return result.embedding.values;
}

export function generateNoteEmbedding(apiKey: string, title: string, content: string): Promise<number[]> {
  return generateEmbedding(apiKey, `${title}\n\n${content}`);
}

export async function generateChatResponse(
  apiKey: string,
  userMessage: string,
  history: Content[],
  contextPrompt: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: CHAT_MODEL, systemInstruction: SYSTEM_PROMPT });
  const chat = model.startChat({ history });
  const messageWithContext = contextPrompt ? `${userMessage}${contextPrompt}` : userMessage;
  const result = await chat.sendMessage(messageWithContext);
  return result.response.text();
}

// Chat session wired to the tool registry's function declarations. The model
// decides for itself whether/which tool to call instead of the caller always
// running a fixed search before every message.
export function startToolChatSession(
  apiKey: string,
  functionDeclarations: FunctionDeclaration[],
  history: Content[]
): ChatSession {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: CHAT_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations }],
  });
  return model.startChat({ history });
}
