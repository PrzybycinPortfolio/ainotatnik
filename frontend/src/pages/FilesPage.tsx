import { useEffect, useRef, useState } from 'react';
import { apiGet, apiUpload } from '../lib/api';
import type { FileRow } from '../types';

const STATUS_LABELS: Record<FileRow['status'], string> = {
  pending: 'W kolejce',
  processing: 'Przetwarzanie…',
  done: 'Gotowe',
  error: 'Błąd',
};

export function FilesPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const list = await apiGet<FileRow[]>('/files');
      setFiles(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFileChange() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      await apiUpload<FileRow>('/files', file);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="files-page">
      <div className="files-header">
        <h2>Faktury i dokumenty</h2>
        <div className="files-actions">
          <label className="upload-btn">
            {uploading ? 'Wysyłanie…' : 'Wgraj plik (PDF / DOCX / TXT)'}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={handleFileChange}
              disabled={uploading}
              hidden
            />
          </label>
          <button onClick={load}>Odśwież</button>
        </div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <table className="files-table">
        <thead>
          <tr>
            <th>Plik</th>
            <th>Status</th>
            <th>Wgrano</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id}>
              <td>{f.filename}</td>
              <td>
                <span className={`status-badge status-${f.status}`}>{STATUS_LABELS[f.status]}</span>
                {f.status === 'error' && f.error_message && <div className="file-error-detail">{f.error_message}</div>}
              </td>
              <td>{new Date(f.created_at).toLocaleString('pl-PL')}</td>
            </tr>
          ))}
          {files.length === 0 && (
            <tr>
              <td colSpan={3} className="chat-empty">
                Brak wgranych plików.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="files-hint">
        Po przetworzeniu faktury zapytaj o nią na czacie — np. "policz koszt uzyskania przychodu za ten miesiąc".
      </p>
    </div>
  );
}
