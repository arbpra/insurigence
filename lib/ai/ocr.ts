import { getOpenAIClient } from './client';
import { AI_MODEL } from './config';

/**
 * OCR / text extraction for scanned PDFs and images.
 *
 * Text-based PDFs are handled by unpdf (lib/ai/pdf.ts) with no AI. When that
 * yields no text (a scanned/image-only PDF) or the upload is an image, we ask a
 * vision-capable model to transcribe the readable text. The transcription then
 * flows into the same deterministic Document Summary extraction — the model
 * transcribes text it can see; it does not invent policy data.
 */

const OCR_PROMPT =
  'You are performing OCR on an insurance document. Transcribe ALL readable text ' +
  'from the document exactly as written, preserving numbers, dates, and labels. ' +
  'Output only the transcribed text with no commentary. If nothing is readable, output an empty string.';

/** Content part types are cast because the SDK typings lag the file input feature. */
type ContentPart = Record<string, unknown>;

export async function ocrExtractText(
  fileBytes: Uint8Array,
  mimeType: string,
  filename: string
): Promise<string> {
  const base64 = Buffer.from(fileBytes).toString('base64');
  const isImage = mimeType.startsWith('image/');

  const content: ContentPart[] = [{ type: 'text', text: OCR_PROMPT }];
  if (isImage) {
    content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } });
  } else {
    content.push({
      type: 'file',
      file: { filename, file_data: `data:${mimeType};base64,${base64}` },
    });
  }

  const completion = await getOpenAIClient().chat.completions.create({
    model: AI_MODEL,
    temperature: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: content as any }],
  });

  return (completion.choices[0]?.message?.content ?? '').trim();
}
