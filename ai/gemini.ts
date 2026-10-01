import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { SYSTEM_PROMPT } from './prompts';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export function createChatModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    systemInstruction: SYSTEM_PROMPT,
  });
}

export async function generateResponse(
  userMessage: string,
  history: Content[] = [],
  contextPrompt = ''
): Promise<string> {
  const model = createChatModel();
  const chat = model.startChat({ history });

  const messageWithContext = contextPrompt
    ? `${userMessage}${contextPrompt}`
    : userMessage;

  const result = await chat.sendMessage(messageWithContext);
  return result.response.text();
}

export async function generateText(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export function messagesToHistory(
  messages: { role: 'user' | 'model'; content: string }[]
): Content[] {
  return messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}
