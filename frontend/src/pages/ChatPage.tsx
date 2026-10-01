import { useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost } from '../lib/api';
import type { Conversation, Message } from '../types';

export function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setMessages((prev) => [
      ...prev,
      { id: `optimistic-${Date.now()}`, conversation_id: conversationId!, role: 'user', content: text, created_at: new Date().toISOString() },
    ]);

    try {
      await apiPost<{ response: string }>(`/conversations/${conversationId}/messages`, { message: text });
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
            <li key={c.id}>
              <button className={c.id === activeId ? 'active' : ''} onClick={() => setActiveId(c.id)}>
                {new Date(c.created_at).toLocaleString('pl-PL')}
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

        <form className="chat-input-row" onSubmit={handleSend}>
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
