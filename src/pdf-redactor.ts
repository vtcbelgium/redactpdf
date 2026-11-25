import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_RULES, findRedactionSpans, sanitizeText } from './calc.ts';

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface ManualBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RedactedPagePreview {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdfRedactionOutput {
  pdfBytes: Uint8Array;
  pageCount: number;
  totalRedactions: number;
  autoRedactions: number;
  manualRedactions: number;
  extractedText: string;
  redactedText: string;
  previews: RedactedPagePreview[];
}

interface TextSegment {
  str: string;
  start: number;
  end: number;
  transform: number[];
  width: number;
  height: number;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function createSampleConfidentialPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const lines: { text: string; bold?: boolean; size?: number; gap?: number }[] = [
    { text: 'MUTUAL NON-DISCLOSURE AGREEMENT', bold: true, size: 18, gap: 28 },
    { text: 'CONFIDENTIAL SAMPLE DOCUMENT — LOCAL BROWSER TEST', size: 10, gap: 26 },
    {
      text: 'This Agreement is entered into by SovereignCorp and Alice Cooper regarding Project Titan.',
      size: 12,
      gap: 24,
    },
    { text: 'Primary Representative Contact', bold: true, size: 13, gap: 20 },
    { text: 'Direct Email: alice.cooper@example.com', size: 12, gap: 18 },
    { text: 'Emergency Line: +1 (555) 432-8765', size: 12, gap: 18 },
    { text: 'Tax ID: 987-65-4321', size: 12, gap: 18 },
    { text: 'Corporate Wire (IBAN): BE68 5390 0754 7034', size: 12, gap: 18 },
    { text: 'Integration Access Token: sec_live_98a7c6f5e4d3c2b1', size: 12, gap: 28 },
    {
      text: 'All disclosures under Project Titan remain strictly confidential between the parties.',
      size: 12,
      gap: 18,
    },
  ];

  let y = 720;
  for (const line of lines) {
    page.drawText(line.text, {
      x: 56,
      y,
      size: line.size ?? 12,
      font: line.bold ? fontBold : fontRegular,
      color: rgb(0.08, 0.1, 0.14),
    });
    y -= line.gap ?? 18;
  }

  return await doc.save();
}

export async function redactPdfDocument(
  pdfBytes: Uint8Array,
  activeRules: string[] = DEFAULT_RULES.map(r => r.id),
  customTerms: string[] = [],
  manualBoxes: Record<number, ManualBox[]> = {}
): Promise<PdfRedactionOutput> {
  if (pdfBytes.byteLength === 0) {
    throw new Error('The selected PDF file is empty.');
  }
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw new Error('PDF exceeds the 25 MB in-browser size limit.');
  }

  const task = pdfjs.getDocument({
    data: pdfBytes.slice(),
    useSystemFonts: true,
    enableXfa: false,
  });

  let viewer: pdfjs.PDFDocumentProxy;
  try {
    viewer = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new Error('Password-protected PDFs cannot be processed automatically.');
    }
    throw new Error('Unable to parse PDF file. Please verify it is a valid PDF.');
  }

  try {
    const outDoc = await PDFDocument.create();
    outDoc.setTitle('');
    outDoc.setAuthor('');
    outDoc.setSubject('');
    outDoc.setKeywords([]);
    outDoc.setProducer('');
    outDoc.setCreator('');

    const previews: RedactedPagePreview[] = [];
    const extractedPages: string[] = [];
    let autoRedactions = 0;
    let manualRedactions = 0;
    const scale = 2.0;

    for (let pageNum = 1; pageNum <= viewer.numPages; pageNum++) {
      const page = await viewer.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Browser 2D canvas context unavailable.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, viewport, background: '#ffffff' }).promise;

      const textContent = await page.getTextContent();
      const segments: TextSegment[] = [];
      let pageText = '';
      let prevEndX: number | null = null;
      let prevY: number | null = null;
      let prevHasEOL = false;

      for (const rawItem of textContent.items) {
        if (!('str' in rawItem) || !rawItem.str) continue;
        const item = rawItem;
        const curX = item.transform[4] ?? 0;
        const curY = item.transform[5] ?? 0;
        const fontSize = Math.hypot(item.transform[0] ?? 12, item.transform[1] ?? 0) || 12;

        if (pageText.length > 0) {
          const lineChanged = prevHasEOL || (prevY !== null && Math.abs(curY - prevY) > fontSize * 0.45);
          const wideGap = prevEndX !== null && curX - prevEndX > fontSize * 0.18;
          if (lineChanged || wideGap) {
            pageText += lineChanged ? '\n' : ' ';
          }
        }

        const start = pageText.length;
        pageText += item.str;
        const end = pageText.length;

        segments.push({
          str: item.str,
          start,
          end,
          transform: item.transform,
          width: item.width,
          height: item.height,
        });

        prevEndX = curX + (item.width || 0);
        prevY = curY;
        prevHasEOL = Boolean(item.hasEOL);
      }

      extractedPages.push(pageText);

      const spans = findRedactionSpans(pageText, activeRules, customTerms);
      autoRedactions += spans.length;

      ctx.fillStyle = '#000000';
      for (const span of spans) {
        for (const seg of segments) {
          if (seg.end <= span.start || seg.start >= span.end) continue;
          const localStart = Math.max(0, span.start - seg.start);
          const localEnd = Math.min(seg.str.length, span.end - seg.start);
          if (localEnd <= localStart || seg.str.length === 0) continue;

          const fracStart = localStart / seg.str.length;
          const fracEnd = localEnd / seg.str.length;
          const tx = pdfjs.Util.transform(viewport.transform, seg.transform);
          const advLen = Math.hypot(tx[0], tx[1]) || 1;
          const ux = tx[0] / advLen;
          const uy = tx[1] / advLen;
          const fontHeight = Math.hypot(tx[2], tx[3]) || (seg.height > 0 ? seg.height * scale : 12 * scale);
          const totalWidth = seg.width > 0 ? seg.width * scale : seg.str.length * fontHeight * 0.55;

          const p0x = tx[4] + ux * (fracStart * totalWidth);
          const p0y = tx[5] + uy * (fracStart * totalWidth);
          const p1x = tx[4] + ux * (fracEnd * totalWidth);
          const p1y = tx[5] + uy * (fracEnd * totalWidth);

          let upX = tx[2];
          let upY = tx[3];
          if (Math.hypot(upX, upY) < 1) {
            upX = uy * fontHeight;
            upY = -ux * fontHeight;
          }

          const corners = [
            { x: p0x - upX * 0.22, y: p0y - upY * 0.22 },
            { x: p1x - upX * 0.22, y: p1y - upY * 0.22 },
            { x: p0x + upX * 0.95, y: p0y + upY * 0.95 },
            { x: p1x + upX * 0.95, y: p1y + upY * 0.95 },
          ];

          const minX = Math.min(...corners.map(c => c.x)) - 2;
          const maxX = Math.max(...corners.map(c => c.x)) + 2;
          const minY = Math.min(...corners.map(c => c.y)) - 2;
          const maxY = Math.max(...corners.map(c => c.y)) + 2;
          ctx.fillRect(minX, minY, Math.max(4, maxX - minX), Math.max(4, maxY - minY));
        }
      }

      const pageManualBoxes = manualBoxes[pageNum] || [];
      manualRedactions += pageManualBoxes.length;
      for (const box of pageManualBoxes) {
        const bx = box.x * canvas.width;
        const by = box.y * canvas.height;
        const bw = box.w * canvas.width;
        const bh = box.h * canvas.height;
        ctx.fillRect(bx, by, bw, bh);
      }

      const dataUrl = canvas.toDataURL('image/png');
      const pngBytes = dataUrlToUint8Array(dataUrl);
      const embedded = await outDoc.embedPng(pngBytes);
      const outPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      previews.push({
        pageNumber: pageNum,
        dataUrl,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      page.cleanup();
    }

    const outBytes = await outDoc.save();
    const extractedText = extractedPages.join('\n\n');
    const textResult = sanitizeText(extractedText, activeRules, customTerms);

    return {
      pdfBytes: outBytes,
      pageCount: viewer.numPages,
      totalRedactions: autoRedactions + manualRedactions,
      autoRedactions,
      manualRedactions,
      extractedText,
      redactedText: textResult.redactedText,
      previews,
    };
  } finally {
    await viewer.cleanup().catch(() => {});
    await task.destroy().catch(() => {});
  }
}
