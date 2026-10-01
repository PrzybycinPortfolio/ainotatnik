import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './types';
import { authMiddleware } from './middleware/auth';
import notes from './routes/notes';
import chat from './routes/chat';
import files from './routes/files';

const app = new Hono<AppBindings>();

app.use(
  '*',
  cors({
    origin: (_origin, c) => c.env.ALLOWED_ORIGIN ?? '*',
  })
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.use('/notes/*', authMiddleware);
app.use('/conversations/*', authMiddleware);
app.use('/files/*', authMiddleware);

app.route('/notes', notes);
app.route('/conversations', chat);
app.route('/files', files);

export default app;
