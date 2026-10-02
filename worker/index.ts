import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './types';
import { authMiddleware } from './middleware/auth';
import notes from './routes/notes';
import chat from './routes/chat';
import files from './routes/files';
import profile from './routes/profile';

const app = new Hono<AppBindings>();

// ALLOWED_ORIGIN: "*" or a comma-separated list; "https://*.example.com" matches any subdomain.
function matchOrigin(origin: string, allowed: string): string | null {
  for (const pattern of allowed.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (pattern === '*') return '*';
    if (pattern === origin) return origin;
    const wildcard = pattern.match(/^(https?:\/\/)\*\.(.+)$/);
    if (wildcard && origin.startsWith(wildcard[1]) && origin.endsWith(`.${wildcard[2]}`)) {
      return origin;
    }
  }
  return null;
}

app.use(
  '*',
  cors({
    origin: (origin, c) => matchOrigin(origin, c.env.ALLOWED_ORIGIN ?? '*'),
  })
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.use('/notes/*', authMiddleware);
app.use('/conversations/*', authMiddleware);
app.use('/files/*', authMiddleware);
app.use('/profile', authMiddleware);
app.use('/profile/*', authMiddleware);

app.route('/notes', notes);
app.route('/conversations', chat);
app.route('/files', files);
app.route('/profile', profile);

export default app;
