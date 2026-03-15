import { traceable as langsmithTraceable } from 'langsmith/traceable';
import * as dotenv from 'dotenv';

dotenv.config();

const isEnabled = !!process.env.LANGSMITH_API_KEY;

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

export function traceable<T extends AnyAsyncFn>(
  fn: T,
  metadata: { name: string; runType?: string }
): T {
  if (!isEnabled) return fn;

  return langsmithTraceable(fn, {
    name: metadata.name,
    run_type: (metadata.runType as 'llm' | 'chain' | 'tool' | 'retriever' | 'embedding') ?? 'chain',
  }) as T;
}

export function log(message: string, data?: unknown): void {
  if (!isEnabled) return;
  console.log(`[LangSmith] ${message}`, data ?? '');
}
