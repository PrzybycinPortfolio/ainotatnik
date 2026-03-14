import * as dotenv from 'dotenv';

dotenv.config();

const isEnabled = !!process.env.LANGSMITH_API_KEY;

export function traceable<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  metadata: { name: string; runType?: string }
): T {
  if (!isEnabled) return fn;

  return (async (...args: Parameters<T>) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      console.log(`[LangSmith] ${metadata.name} completed in ${duration}ms`);
      return result;
    } catch (err) {
      console.error(`[LangSmith] ${metadata.name} failed:`, err);
      throw err;
    }
  }) as T;
}

export function log(message: string, data?: unknown): void {
  if (!isEnabled) return;
  console.log(`[LangSmith] ${message}`, data ?? '');
}
