import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Extract plain text from a PDF buffer. Uses unpdf (a serverless-friendly
 * wrapper around pdf.js) so it works in the Next.js Node runtime without the
 * import-time pitfalls of pdf-parse.
 *
 * Returns the merged text of all pages. Throws if the PDF can't be parsed.
 */
export async function extractPdfText(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join('\n') : text).trim();
}
