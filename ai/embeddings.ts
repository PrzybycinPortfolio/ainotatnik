import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

export async function generateEmbedding(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

export async function generateNoteEmbedding(title: string, content: string): Promise<number[]> {
  const combined = `${title}\n\n${content}`;
  return generateEmbedding(combined);
}
