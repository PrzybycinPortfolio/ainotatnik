import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Markdown } from '../components/Markdown';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import type { Note } from '../types';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
const TITLE_MAX = 200;
const CONTENT_MAX = 20000;

type Mode = { kind: 'view' } | { kind: 'new' } | { kind: 'edit'; noteId: string };

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

// Plain-text preview for cards: strip the most common Markdown markers.
function snippet(content: string) {
  return content
    .replace(/[#>*_`|~-]+/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => notes.find((n) => n.id === selectedId) ?? null, [notes, selectedId]);
  const editing = mode.kind !== 'view';
  const dirty =
    mode.kind === 'new'
      ? draftTitle.trim() !== '' || draftContent.trim() !== ''
      : mode.kind === 'edit' && selected
        ? draftTitle !== selected.title || draftContent !== selected.content
        : false;

  // Short queries list everything; longer ones search title and content on the server.
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(
      () => load(q.length >= 2 ? q : ''),
      q ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [mode.kind]);

  async function load(q = query.trim().length >= 2 ? query.trim() : '') {
    setLoading(true);
    try {
      const list = q
        ? await apiGet<Note[]>(`/notes/search?q=${encodeURIComponent(q)}`)
        : await apiGet<Note[]>(`/notes?pageSize=${PAGE_SIZE}`);
      setNotes(list);
      setSelectedId((prev) => (prev && list.some((n) => n.id === prev) ? prev : (list[0]?.id ?? null)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function confirmDiscard() {
    return !dirty || confirm('Masz niezapisane zmiany. Porzucić je?');
  }

  function select(id: string) {
    if (id === selectedId && !editing) return;
    if (!confirmDiscard()) return;
    setSelectedId(id);
    setMode({ kind: 'view' });
  }

  function startNew() {
    if (!confirmDiscard()) return;
    setDraftTitle('');
    setDraftContent('');
    setMode({ kind: 'new' });
  }

  function startEdit(note: Note) {
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setMode({ kind: 'edit', noteId: note.id });
  }

  function cancelEdit() {
    if (!confirmDiscard()) return;
    setMode({ kind: 'view' });
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const title = draftTitle.trim();
    const content = draftContent.trim();
    if (!title || !content) {
      setError('Notatka musi mieć tytuł i treść.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (mode.kind === 'new') {
        const note = await apiPost<Note>('/notes', { title, content });
        setNotes((prev) => [note, ...prev]);
        setSelectedId(note.id);
      } else if (mode.kind === 'edit') {
        const note = await apiPatch<Note>(`/notes/${mode.noteId}`, { title, content });
        // Edited notes move to the top, matching the server's updated_at ordering.
        setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)]);
      }
      setMode({ kind: 'view' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(note: Note) {
    if (!confirm(`Usunąć notatkę „${note.title}”? Tego nie można cofnąć.`)) return;
    setError(null);
    try {
      await apiDelete(`/notes/${note.id}`);
      const remaining = notes.filter((n) => n.id !== note.id);
      setNotes(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setMode({ kind: 'view' });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Ctrl/Cmd+Enter saves, Escape cancels — from anywhere in the editor.
  function onEditorKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className="notes-layout">
      <aside className="notes-sidebar">
        <button className="new-chat-btn" onClick={startNew}>
          + Nowa notatka
        </button>
        <input
          className="notes-search"
          type="search"
          placeholder="Szukaj w notatkach…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="notes-count">
          {loading ? 'Ładowanie…' : query.trim().length >= 2 ? `Znaleziono: ${notes.length}` : `Notatek: ${notes.length}`}
        </div>
        <ul className="notes-list">
          {notes.map((n) => (
            <li key={n.id}>
              <button
                className={`note-card${n.id === selectedId && mode.kind !== 'new' ? ' active' : ''}`}
                onClick={() => select(n.id)}
              >
                <span className="note-card-title">{n.title}</span>
                <span className="note-card-snippet">{snippet(n.content)}</span>
                <span className="note-card-date">{formatDate(n.updated_at)}</span>
              </button>
            </li>
          ))}
          {!loading && notes.length === 0 && (
            <li className="notes-empty">
              {query.trim()
                ? 'Brak notatek pasujących do wyszukiwania.'
                : 'Nie masz jeszcze notatek. Utwórz pierwszą przyciskiem powyżej albo napisz w czacie: „Zapisz notatkę …”.'}
            </li>
          )}
        </ul>
      </aside>

      <section className="notes-main">
        {error && <p className="auth-error">{error}</p>}

        {editing ? (
          <form className="note-editor" onSubmit={save} onKeyDown={onEditorKeyDown}>
            <input
              ref={titleRef}
              className="note-editor-title"
              placeholder="Tytuł"
              value={draftTitle}
              maxLength={TITLE_MAX}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <textarea
              className="note-editor-content"
              placeholder={'Treść notatki…\n\nMożesz używać Markdown: **pogrubienie**, - listy, | tabele |'}
              value={draftContent}
              maxLength={CONTENT_MAX}
              onChange={(e) => setDraftContent(e.target.value)}
            />
            <div className="note-editor-actions">
              <span className="note-editor-hint">Ctrl+Enter — zapisz · Esc — anuluj</span>
              <button type="button" className="link-btn" onClick={cancelEdit} disabled={saving}>
                Anuluj
              </button>
              <button type="submit" className="note-save-btn" disabled={saving || !draftTitle.trim() || !draftContent.trim()}>
                {saving ? 'Zapisywanie…' : 'Zapisz'}
              </button>
            </div>
          </form>
        ) : selected ? (
          <article className="note-view">
            <header className="note-view-header">
              <div>
                <h2>{selected.title}</h2>
                <div className="note-view-meta">
                  Utworzono {formatDate(selected.created_at)}
                  {selected.updated_at !== selected.created_at && ` · edytowano ${formatDate(selected.updated_at)}`}
                </div>
              </div>
              <div className="note-view-actions">
                <button className="retry-btn" onClick={() => startEdit(selected)}>
                  Edytuj
                </button>
                <button className="delete-btn" onClick={() => remove(selected)}>
                  Usuń
                </button>
              </div>
            </header>
            <Markdown className="note-view-content">{selected.content}</Markdown>
          </article>
        ) : (
          !loading && (
            <div className="notes-placeholder">
              <p>Wybierz notatkę z listy albo utwórz nową.</p>
              <p className="files-hint">
                Notatki możesz też dodawać z czatu, np. „Zapisz notatkę <i>Spotkanie 01.10</i>: …” — pojawią się tutaj.
              </p>
            </div>
          )
        )}
      </section>
    </div>
  );
}
