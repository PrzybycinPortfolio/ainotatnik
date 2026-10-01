import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, apiPostForm } from '../lib/api';
import type { Conversation, Message } from '../types';

export function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local file kept only in the browser and re-sent with every message until detached; never stored server-side.
  const [attachment, setAttachment] = useState<File | null>(null);
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
    const content = attachment ? `📎 ${attachment.name}\n${text}` : text;
    setMessages((prev) => [
      ...prev,
      { id: `optimistic-${Date.now()}`, conversation_id: conversationId!, role: 'user', content, created_at: new Date().toISOString() },
    ]);

    try {
      const path = `/conversations/${conversationId}/messages`;
      if (attachment) {
        const form = new FormData();
        form.append('message', text);
        form.append('file', attachment);
        await apiPostForm<{ response: string }>(path, form);
      } else {
        await apiPost<{ response: string }>(path, { message: text });
      }
      await loadMessages(conversationId);
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
            <div key={m.id} className={`chat-bubble ${m.role}`}>
              <div className="chat-bubble-content">{m.content}</div>
            </div>
          ))}
          {sending && <div className="chat-bubble model chat-pending">AI pisze…</div>}
        </div>

        {error && <p className="auth-error">{error}</p>}

        {attachment && (
          <div className="chat-attachment">
            <span title="Plik nie jest zapisywany w aplikacji — jest wysyłany do AI razem z każdą wiadomością">
              📎 {attachment.name} <small>(z komputera, bez zapisu)</small>
            </span>
            <button type="button" onClick={() => setAttachment(null)} aria-label="Odepnij plik">
              ✕
            </button>
          </div>
        )}

        <form className="chat-input-row" onSubmit={handleSend}>
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title="Dołącz plik z komputera bez wgrywania (PDF / DOCX / TXT / MD)"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            hidden
            onChange={(e) => {
              setAttachment(e.target.files?.[0] ?? null);
              e.target.value = '';
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
