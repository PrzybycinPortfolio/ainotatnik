// Text extraction happens in the browser (frontend/src/lib/extractText.ts):
// parsing PDFs on the Worker exceeds the Workers CPU limit. The Worker only
// validates the file type and receives the already-extracted text.

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const SUPPORTED_UPLOAD_MIME_TYPES = [PDF_MIME, DOCX_MIME, 'text/plain', 'text/markdown'];

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  txt: 'text/plain',
  md: 'text/markdown',
};

// Browsers (notably on Windows) often send an empty type for .md files.
export function detectMimeType(filename: string, reportedType: string): string {
  return reportedType || MIME_BY_EXTENSION[filename.split('.').pop()?.toLowerCase() ?? ''] || '';
}
