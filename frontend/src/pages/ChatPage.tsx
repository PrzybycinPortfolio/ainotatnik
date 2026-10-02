import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { extractFileText } from '../lib/extractText';
import type { Conversation, Message } from '../types';

type Attachment = { name: string; text: string };

// Matches the Worker's limits: at most 100 files and ~500k characters in total
// per message. When many files are attached, each is trimmed to fit the budget.
const MAX_ATTACHMENTS = 100;
const ATTACHMENTS_TOTAL_CHARS = 490_000;
const PER_FILE_MAX_CHARS = 60_000;

function fitToBudget(list: Attachment[]): Attachment[] {
  const perFile = Math.min(PER_FILE_MAX_CHARS, Math.floor(ATTACHMENTS_TOTAL_CHARS / Math.max(list.length, 1)));
  return list.map((a) => ({ name: a.name, text: a.text.slice(0, perFile) }));
}

function attachmentMarker(names: string[]): string {
  if (names.length === 1) return `📎 ${names[0]}`;
  const shown = names.slice(0, 5).join(', ');
  return `📎 ${names.length} plików: ${shown}${names.length > 5 ? `, … (+${names.length - 5})` : ''}`;
}

export function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local files kept only in the browser and re-sent with every message until detached; never stored server-side.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [showAttachmentList, setShowAttachmentList] = useState(false);
  const trimmed =
    attachments.length > 0 && fitToBudget(attachments).some((a, i) => a.text.length < attachments[i].text.length);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
  }, [activeId]);

  async function loadConversations() {
    try {
      const list = await apiGet<Conversation[]>('/conversations');
      setConversations(list);
      if (!activeId && list.length > 0) setActiveId(list[0].id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadMessages(conversationId: string) {
    try {
      const list = await apiGet<Message[]>(`/conversations/${conversationId}/messages`);
      setMessages(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createConversation() {
    try {
      const conv = await apiPost<Conversation>('/conversations');
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setMessages([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Text is extracted once, in the browser; only the text is sent with messages.
  // Picking more files adds to the current set (up to MAX_ATTACHMENTS).
  async function handleAttach(picked: File[]) {
    const room = MAX_ATTACHMENTS - attachments.length;
    const files = picked.slice(0, Math.max(room, 0));
    const problems: string[] = [];
    if (picked.length > files.length) {
      problems.push(`Można dołączyć maksymalnie ${MAX_ATTACHMENTS} plików — pominięto ${picked.length - files.length}.`);
    }

    setError(null);
    setReading({ done: 0, total: files.length });
    const added: Attachment[] = [];
    for (const file of files) {
      try {
        added.push({ name: file.name, text: await extractFileText(file) });
      } catch (err) {
        problems.push(`${file.name}: ${(err as Error).message}`);
      }
      setReading((r) => (r ? { ...r, done: r.done + 1 } : r));
    }
    setAttachments((prev) => [...prev, ...added]);
    setReading(null);
    if (problems.length > 0) setError(problems.join('\n'));
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function deleteConversation(conv: Conversation) {
    const label = new Date(conv.created_at).toLocaleString('pl-PL');
    if (!confirm(`Usunąć rozmowę z ${label}? Wszystkie jej wiadomości zostaną trwale usunięte.`)) return;

    try {
      await apiDelete(`/conversations/${conv.id}`);
      const remaining = conversations.filter((c) => c.id !== conv.id);
      setConversations(remaining);
      if (conv.id === activeId) {
        setActiveId(remaining[0]?.id ?? null);
        setMessages([]);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    let conversationId = activeId;
    if (!conversationId) {
      const conv = await apiPost<Conversation>('/conversations');
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      conversationId = conv.id;
    }

    setInput('');
    setSending(true);
    setError(null);
    const content = attachments.length > 0 ? `${attachmentMarker(attachments.map((a) => a.name))}\n${text}` : text;
    setMessages((prev) => [
      ...prev,
      { id: `optimistic-${Date.now()}`, conversation_id: conversationId!, role: 'user', content, created_at: new Date().toISOString() },
    ]);

    try {
      const result = await apiPost<{ response: string; failed?: boolean }>(`/conversations/${conversationId}/messages`, {
        message: text,
        ...(attachments.length > 0 && { attachments: fitToBudget(attachments) }),
      });
      await loadMessages(conversationId);
      // AI failures come back as a message to show in the chat; it is not stored, so append it locally.
      if (result.failed) {
        setMessages((prev) => [
          ...prev,
          { id: `error-${Date.now()}`, conversation_id: conversationId!, role: 'model', content: result.response, created_at: new Date().toISOString() },
        ]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button className="new-chat-btn" onClick={createConversation}>
          + Nowa rozmowa
        </button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id} className="chat-sidebar-item">
              <button className={c.id === activeId ? 'active' : ''} onClick={() => setActiveId(c.id)}>
                {new Date(c.created_at).toLocaleString('pl-PL')}
              </button>
              <button
                className="chat-delete-btn"
                onClick={() => deleteConversation(c)}
                title="Usuń rozmowę"
                aria-label="Usuń rozmowę"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="chat-empty">
              Zapytaj o cokolwiek — notatki, koszt uzyskania przychodu z faktur, albo przepisy prawne z wgranych
              aktów.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble ${m.role}${m.id.startsWith('error-') ? ' chat-error' : ''}`}>
              {m.role === 'model' ? (
                // Raw HTML is not rendered (react-markdown's default), so model output
                // or attached-document text can't inject markup into the page.
                <div className="chat-bubble-content markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="chat-bubble-content">{m.content}</div>
              )}
            </div>
          ))}
          {sending && <div className="chat-bubble model chat-pending">AI pisze…</div>}
        </div>

        {error && <p className="auth-error">{error}</p>}

        {reading && (
          <div className="chat-attachment">
            <span>
              Odczytywanie plików… {reading.done}/{reading.total}
            </span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="chat-attachments">
            <div className="chat-attachment">
              <span title="Pliki nie są zapisywane w aplikacji — ich tekst jest wysyłany do AI razem z każdą wiadomością">
                📎 {attachments.length === 1 ? attachments[0].name : `${attachments.length} plików`}{' '}
                <small>(z komputera, bez zapisu)</small>
              </span>
              <span className="chat-attachment-actions">
                {attachments.length > 1 && (
                  <button type="button" onClick={() => setShowAttachmentList((v) => !v)}>
                    {showAttachmentList ? 'Ukryj listę' : 'Pokaż listę'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAttachments([]);
                    setShowAttachmentList(false);
                  }}
                  aria-label="Odepnij wszystkie pliki"
                  title="Odepnij wszystkie"
                >
                  ✕
                </button>
              </span>
            </div>
            {trimmed && (
              <p className="chat-attachment-note">
                Dużo plików naraz — z każdego wysyłany jest początkowy fragment tekstu, żeby zmieścić się w limicie.
              </p>
            )}
            {showAttachmentList && attachments.length > 1 && (
              <ul className="chat-attachment-list">
                {attachments.map((a, i) => (
                  <li key={`${a.name}-${i}`}>
                    <span>{a.name}</span>
                    <button type="button" onClick={() => removeAttachment(i)} aria-label={`Odepnij ${a.name}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <form className="chat-input-row" onSubmit={handleSend}>
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || reading !== null}
            title="Dołącz pliki z komputera bez wgrywania (PDF / DOCX / TXT / MD) — można zaznaczyć wiele"
          >
            {reading ? '…' : '📎'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length > 0) handleAttach(picked);
            }}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Napisz wiadomość…"
            disabled={sending}
          />
          <button type="submit" disabled={sending || !input.trim()}>
            Wyślij
          </button>
        </form>
      </section>
    </div>
  );
}
