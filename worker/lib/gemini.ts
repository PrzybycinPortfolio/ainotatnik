import { GoogleGenerativeAI, type ChatSession, type Content, type FunctionDeclaration } from '@google/generative-ai';
import { SYSTEM_PROMPT } from '../../ai/prompts';

const EMBEDDING_MODEL = 'gemini-embedding-001';
// Tried in order: when a model is overloaded (503), over quota (429) or retired
// (404), the next one is used. Older 2.5 models are closed to new API keys and
// Pro models have no free-tier quota.
export const CHAT_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

// Runs `fn` with each model in turn until one succeeds; rethrows the last error.
export async function withModelFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const model of CHAT_MODELS) {
    try {
      return await fn(model);
    } catch (err) {
      lastError = err;
      console.error(`Gemini model ${model} failed:`, (err as Error).message);
    }
  }
  throw lastError;
}
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
  const messageWithContext = contextPrompt ? `${userMessage}${contextPrompt}` : userMessage;
  return withModelFallback(async (modelName) => {
    const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: SYSTEM_PROMPT });
    const result = await model.startChat({ history }).sendMessage(messageWithContext);
    return result.response.text();
  });
}

// Chat session wired to the tool registry's function declarations. The model
// decides for itself whether/which tool to call instead of the caller always
// running a fixed search before every message.
export function startToolChatSession(
  apiKey: string,
  modelName: string,
  functionDeclarations: FunctionDeclaration[],
  history: Content[]
): ChatSession {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    // An empty list means "no tools" (e.g. document-scoped turns); Gemini rejects an empty declarations array.
    ...(functionDeclarations.length > 0 && { tools: [{ functionDeclarations }] }),
  });
  return model.startChat({ history });
}
