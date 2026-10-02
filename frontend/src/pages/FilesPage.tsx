import { useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../lib/api';
import { extractFileText } from '../lib/extractText';
import type { FileRow } from '../types';

const STATUS_LABELS: Record<FileRow['status'], string> = {
  pending: 'W kolejce',
  processing: 'Przetwarzanie…',
  done: 'Gotowe',
  error: 'Błąd',
};

// Bulk operations run a few at a time: each upload triggers two Gemini calls,
// and bursting 50 at once mostly produces rate-limit errors.
const CONCURRENCY = 2;
const POLL_INTERVAL_MS = 5000;
// Files that failed (usually a Gemini rate limit) are retried automatically, one
// at a time, with a growing pause: 30 s, 60 s, 90 s. After that, "Ponów" by hand.
const AUTO_RETRY_MAX_ATTEMPTS = 3;
const AUTO_RETRY_BASE_DELAY_MS = 30_000;
const AUTO_RETRY_CHECK_MS = 10_000;

type Progress = { label: string; done: number; total: number };
type Failure = { name: string; message: string };

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, onDone: () => void) {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      onDone();
    }
  });
  await Promise.all(runners);
}

export function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null;
  const allSelected = files.length > 0 && selected.size === files.length;
  const selectedFiles = files.filter((f) => selected.has(f.id));
  const selectedErrors = selectedFiles.filter((f) => f.status === 'error');
  const inProgress = files.some((f) => f.status === 'pending' || f.status === 'processing');

  // Per-file auto-retry bookkeeping for this browser session.
  const retryAttempts = useRef(new Map<string, { count: number; lastAt: number }>());
  const autoRetrying = useRef(false);
  const isRetryable = (f: FileRow) =>
    f.status === 'error' && (retryAttempts.current.get(f.id)?.count ?? 0) < AUTO_RETRY_MAX_ATTEMPTS;
  const retryable = files.filter(isRetryable);
  // The interval callback reads the latest list from here, never a stale render's copy.
  const filesRef = useRef(files);
  filesRef.current = files;

  // VAT status decides the KUP basis: true → net, false → gross, null → not chosen yet.
  const [vatPayer, setVatPayer] = useState<boolean | null | undefined>(undefined);
  const [savingVat, setSavingVat] = useState(false);

  useEffect(() => {
    load();
    apiGet<{ vat_payer: boolean | null }>('/profile')
      .then((p) => setVatPayer(p.vat_payer))
      .catch((err) => setError((err as Error).message));
  }, []);

  async function saveVatPayer(value: boolean) {
    const previous = vatPayer;
    setVatPayer(value);
    setSavingVat(true);
    try {
      await apiPut('/profile', { vat_payer: value });
    } catch (err) {
      setVatPayer(previous);
      setError((err as Error).message);
    } finally {
      setSavingVat(false);
    }
  }

  useEffect(() => {
    if (retryable.length === 0 || busy) return;
    const timer = setInterval(autoRetryTick, AUTO_RETRY_CHECK_MS);
    autoRetryTick();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryable.length, busy]);

  async function autoRetryTick() {
    if (autoRetrying.current) return;
    const now = Date.now();
    const due = filesRef.current.filter(isRetryable).find((f) => {
      const a = retryAttempts.current.get(f.id);
      // First attempt waits one base delay from when the error was first seen.
      if (!a) {
        retryAttempts.current.set(f.id, { count: 0, lastAt: now });
        return false;
      }
      return now - a.lastAt >= AUTO_RETRY_BASE_DELAY_MS * (a.count + 1);
    });
    if (!due) return;

    autoRetrying.current = true;
    const a = retryAttempts.current.get(due.id)!;
    retryAttempts.current.set(due.id, { count: a.count + 1, lastAt: Date.now() });
    try {
      await reprocess(due);
    } catch (err) {
      console.warn('Auto-retry failed for', due.filename, err);
    } finally {
      autoRetrying.current = false;
      await load();
    }
  }

  // While invoices are being processed, refresh the list so statuses update on their own.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inProgress]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected, allSelected]);

  async function load() {
    try {
      const list = await apiGet<FileRow[]>('/files');
      setFiles(list);
      // Drop selections of files that no longer exist.
      setSelected((prev) => new Set(list.filter((f) => prev.has(f.id)).map((f) => f.id)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function runBulk<T>(label: string, items: T[], name: (item: T) => string, action: (item: T) => Promise<void>) {
    setError(null);
    setFailures([]);
    setProgress({ label, done: 0, total: items.length });
    const failed: Failure[] = [];
    await runPool(
      items,
      async (item) => {
        try {
          await action(item);
        } catch (err) {
          failed.push({ name: name(item), message: (err as Error).message });
        }
      },
      () => setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    );
    setProgress(null);
    setFailures(failed);
    await load();
  }

  async function handleFileChange() {
    const picked = Array.from(inputRef.current?.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (picked.length === 0) return;

    // Text is extracted in the browser; the Worker only stores the file and runs the AI steps.
    await runBulk('Wgrywanie', picked, (f) => f.name, async (file) => {
      const text = await extractFileText(file);
      await apiUpload<FileRow>('/files', file, { text });
    });
  }

  async function reprocess(file: FileRow) {
    // The text isn't stored, so re-read it from the stored file in the browser.
    const { url } = await apiGet<{ url: string }>(`/files/${file.id}/url`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Nie udało się pobrać pliku');
    const blob = await res.blob();
    const text = await extractFileText(new File([blob], file.filename, { type: file.mime_type || blob.type }));
    await apiPost(`/files/${file.id}/reprocess`, { text });
  }

  async function handleOpen(file: FileRow) {
    // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
    const tab = window.open('', '_blank');
    setError(null);
    try {
      const { url } = await apiGet<{ url: string }>(`/files/${file.id}/url`);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError((err as Error).message);
    }
  }

  async function handleDelete(targets: FileRow[]) {
    const question =
      targets.length === 1
        ? `Usunąć plik "${targets[0].filename}"?`
        : `Usunąć ${targets.length} zaznaczonych plików?`;
    if (!confirm(`${question} Faktury odczytane z tych plików też zostaną usunięte. Tego nie można cofnąć.`)) return;

    await runBulk('Usuwanie', targets, (f) => f.filename, (f) => apiDelete(`/files/${f.id}`));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));
  }

  return (
    <div className="files-page">
      <div className="files-header">
        <h2>Faktury</h2>
        <div className="files-actions">
          <label className={`upload-btn${busy ? ' disabled' : ''}`}>
            Wgraj pliki (PDF / DOCX / TXT)
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              multiple
              onChange={handleFileChange}
              disabled={busy}
              hidden
            />
          </label>
          <button onClick={load} disabled={busy}>
            Odśwież
          </button>
        </div>
      </div>

      <p className="files-hint files-hint-top">
        Możesz zaznaczyć wiele plików naraz w oknie wyboru (Ctrl+A, Ctrl lub Shift + klik).
      </p>

      {vatPayer !== undefined && (
        <fieldset className={`vat-setting${vatPayer === null ? ' unset' : ''}`} disabled={savingVat}>
          <legend>Rozliczenie VAT — od tego zależy, jak liczony jest KUP</legend>
          <label>
            <input type="radio" name="vat" checked={vatPayer === true} onChange={() => saveVatPayer(true)} />
            <span>
              <b>Czynny podatnik VAT</b> — KUP liczony z kwot <b>netto</b> (VAT odliczasz)
            </span>
          </label>
          <label>
            <input type="radio" name="vat" checked={vatPayer === false} onChange={() => saveVatPayer(false)} />
            <span>
              <b>Nie jestem vatowcem</b> (np. zwolnienie z VAT) — KUP liczony z kwot <b>brutto</b>
            </span>
          </label>
          {vatPayer === null && (
            <p className="vat-hint">Nie wybrano — do tego czasu asystent pokaże obie sumy, netto i brutto.</p>
          )}
        </fieldset>
      )}

      {progress && (
        <div className="bulk-progress">
          <span>
            {progress.label}… {progress.done}/{progress.total}
          </span>
          <progress value={progress.done} max={progress.total} />
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}

      {(inProgress || retryable.length > 0) && !busy && (
        <p className="files-hint auto-status">
          {inProgress && 'Przetwarzanie faktur trwa — lista odświeża się sama. '}
          {retryable.length > 0 &&
            `Automatyczne ponawianie: ${retryable.length} ${retryable.length === 1 ? 'plik' : 'plików'} z błędem (kolejna próba w ciągu ~${AUTO_RETRY_BASE_DELAY_MS / 1000} s).`}
        </p>
      )}

      {failures.length > 0 && (
        <div className="bulk-failures">
          <div className="bulk-failures-head">
            <b>Nie powiodło się: {failures.length}</b>
            <button onClick={() => setFailures([])} aria-label="Zamknij">
              ✕
            </button>
          </div>
          <ul>
            {failures.map((f, i) => (
              <li key={i}>
                {f.name} — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>Zaznaczono: {selected.size}</span>
          {selectedErrors.length > 0 && (
            <button
              onClick={() => runBulk('Ponawianie', selectedErrors, (f) => f.filename, reprocess)}
              disabled={busy}
            >
              Ponów błędne ({selectedErrors.length})
            </button>
          )}
          <button className="delete-btn" onClick={() => handleDelete(selectedFiles)} disabled={busy}>
            Usuń zaznaczone
          </button>
          <button className="link-btn" onClick={() => setSelected(new Set())} disabled={busy}>
            Odznacz
          </button>
        </div>
      )}

      <table className="files-table">
        <thead>
          <tr>
            <th className="check-col">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={files.length === 0 || busy}
                aria-label="Zaznacz wszystkie"
                title="Zaznacz wszystkie"
              />
            </th>
            <th>Plik</th>
            <th>Status</th>
            <th>Wgrano</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className={selected.has(f.id) ? 'selected' : ''}>
              <td className="check-col">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  disabled={busy}
                  aria-label={`Zaznacz ${f.filename}`}
                />
              </td>
              <td>
                <button className="file-link" onClick={() => handleOpen(f)} title="Otwórz plik">
                  {f.filename}
                </button>
              </td>
              <td>
                <span className={`status-badge status-${f.status}`}>{STATUS_LABELS[f.status]}</span>
                {f.status === 'error' && f.error_message && <div className="file-error-detail">{f.error_message}</div>}
              </td>
              <td>{new Date(f.created_at).toLocaleString('pl-PL')}</td>
              <td className="row-actions">
                {f.status === 'error' && (
                  <button
                    className="retry-btn"
                    onClick={() => runBulk('Ponawianie', [f], (x) => x.filename, reprocess)}
                    disabled={busy}
                  >
                    Ponów
                  </button>
                )}
                <button className="delete-btn" onClick={() => handleDelete([f])} disabled={busy}>
                  Usuń
                </button>
              </td>
            </tr>
          ))}
          {files.length === 0 && (
            <tr>
              <td colSpan={5} className="chat-empty">
                Brak wgranych plików.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="files-hint">
        Po przetworzeniu faktury zapytaj o nią na czacie — np. "policz koszt uzyskania przychodu za ten miesiąc".
        Pliki z błędem aplikacja ponawia sama (do 3 razy); możesz też zaznaczyć je i kliknąć „Ponów błędne”.
      </p>
    </div>
  );
}
