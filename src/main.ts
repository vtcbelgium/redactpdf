import { initTheme } from './theme.ts';
import { initModals } from './modals.ts';
import { showToast } from './toast.ts';
import { auditCookies } from './cookies.ts';
import { auditVault } from './vault.ts';
import { sanitizeText } from './calc.ts';
import {
  createSampleConfidentialPdf,
  ManualBox,
  PdfRedactionOutput,
  redactPdfDocument,
} from './pdf-redactor.ts';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initModals();

  const audit = auditCookies();
  const vault = auditVault();
  console.log(`[OTHRYS] RedactPDF initialized. Cookies: ${audit.totalCookies}, Vault: ${vault.clientSideOnly}`);

  const inputEl = document.getElementById('app-input') as HTMLTextAreaElement | null;
  const customTermsEl = document.getElementById('custom-terms-input') as HTMLInputElement | null;
  const outputRegion = document.getElementById('output-region');
  const sampleBtn = document.getElementById('action-sample');
  const clearBtn = document.getElementById('action-clear');
  const copyBtn = document.getElementById('action-copy');

  const pdfDropzone = document.getElementById('pdf-dropzone');
  const pdfFileInput = document.getElementById('pdf-file-input') as HTMLInputElement | null;
  const samplePdfBtn = document.getElementById('action-sample-pdf') as HTMLButtonElement | null;
  const downloadPdfBtn = document.getElementById('action-download-pdf') as HTMLButtonElement | null;
  const undoManualBtn = document.getElementById('action-undo-manual') as HTMLButtonElement | null;
  const clearPdfBtn = document.getElementById('action-clear-pdf') as HTMLButtonElement | null;
  const pdfPreviewRegion = document.getElementById('pdf-preview-region');

  const ruleEmail = document.getElementById('rule-email') as HTMLInputElement | null;
  const rulePhone = document.getElementById('rule-phone') as HTMLInputElement | null;
  const ruleSsn = document.getElementById('rule-ssn') as HTMLInputElement | null;
  const ruleFin = document.getElementById('rule-financial') as HTMLInputElement | null;
  const ruleKey = document.getElementById('rule-apikey') as HTMLInputElement | null;

  let lastRedactedText = '';
  let loadedPdfBytes: Uint8Array | null = null;
  let loadedPdfName = 'document.pdf';
  let lastPdfOutput: PdfRedactionOutput | null = null;
  let manualBoxes: Record<number, ManualBox[]> = {};
  let manualHistory: number[] = [];
  let pdfRunId = 0;

  function getActiveRules(): string[] {
    const activeRules: string[] = [];
    if (ruleEmail?.checked) activeRules.push('email');
    if (rulePhone?.checked) activeRules.push('phone');
    if (ruleSsn?.checked) activeRules.push('ssn-id');
    if (ruleFin?.checked) activeRules.push('credit-card');
    if (ruleKey?.checked) activeRules.push('api-key');
    return activeRules;
  }

  function getCustomTerms(): string[] {
    return customTermsEl?.value
      ? customTermsEl.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];
  }

  function processRedaction() {
    if (!outputRegion) return;
    const text = inputEl ? inputEl.value : '';

    if (!text.trim()) {
      outputRegion.innerHTML = '<div class="output-placeholder">Enter document text above to view instant pattern sanitization and redacted text.</div>';
      lastRedactedText = '';
      return;
    }

    const res = sanitizeText(text, getActiveRules(), getCustomTerms());
    lastRedactedText = res.redactedText;

    outputRegion.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding: 0.6rem 0.85rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px;">
        <span style="font-size: 0.85rem;"><strong>Sanitization Complete:</strong> ${res.totalRedactions} sensitive item(s) scrubbed.</span>
        <span style="font-size: 0.75rem; color: #22c55e; font-weight: 700;">● ZERO UPLOAD LEAK</span>
      </div>

      <div style="margin-bottom: 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--color-text);">Clean Redacted Output:</div>
      <pre style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; padding: 1rem; font-family: var(--font-mono); font-size: 0.85rem; white-space: pre-wrap; word-break: break-all; max-height: 350px; overflow-y: auto;">${escapeHtml(res.redactedText)}</pre>
    `;
  }

  function updatePdfButtons() {
    if (downloadPdfBtn) downloadPdfBtn.disabled = !lastPdfOutput;
    if (undoManualBtn) undoManualBtn.disabled = manualHistory.length === 0;
    if (clearPdfBtn) clearPdfBtn.hidden = !loadedPdfBytes;
  }

  function attachManualDrawing(wrap: HTMLElement, pageNum: number) {
    const selBox = document.createElement('div');
    selBox.className = 'pdf-selection-box';
    wrap.appendChild(selBox);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = wrap.getBoundingClientRect();
      startX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      startY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      dragging = true;
      wrap.setPointerCapture(e.pointerId);
      selBox.style.left = `${startX}px`;
      selBox.style.top = `${startY}px`;
      selBox.style.width = '0px';
      selBox.style.height = '0px';
      selBox.style.display = 'block';
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = wrap.getBoundingClientRect();
      const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      selBox.style.left = `${Math.min(startX, curX)}px`;
      selBox.style.top = `${Math.min(startY, curY)}px`;
      selBox.style.width = `${Math.abs(curX - startX)}px`;
      selBox.style.height = `${Math.abs(curY - startY)}px`;
    });

    const finishDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      selBox.style.display = 'none';
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const wPx = Math.abs(endX - startX);
      const hPx = Math.abs(endY - startY);
      if (wPx < 6 || hPx < 6) return;

      const box: ManualBox = {
        x: Math.min(startX, endX) / rect.width,
        y: Math.min(startY, endY) / rect.height,
        w: wPx / rect.width,
        h: hPx / rect.height,
      };
      if (!manualBoxes[pageNum]) manualBoxes[pageNum] = [];
      manualBoxes[pageNum].push(box);
      manualHistory.push(pageNum);
      void runPdfRedaction(false);
    };

    wrap.addEventListener('pointerup', finishDrag);
    wrap.addEventListener('pointercancel', () => {
      dragging = false;
      selBox.style.display = 'none';
    });
  }

  function renderPdfPreviews(out: PdfRedactionOutput) {
    if (!pdfPreviewRegion) return;
    pdfPreviewRegion.hidden = false;
    pdfPreviewRegion.innerHTML = '';

    const banner = document.createElement('div');
    banner.className = 'pdf-preview-banner';
    banner.innerHTML = `
      <span><strong>${escapeHtml(loadedPdfName)}</strong> · ${out.pageCount} page(s) · <strong>${out.totalRedactions}</strong> redaction(s) (${out.autoRedactions} auto, ${out.manualRedactions} manual)</span>
      <span style="font-size: 0.75rem; color: #22c55e; font-weight: 700;">● FLATTENED PIXEL PDF (METADATA STRIPPED)</span>
    `;
    pdfPreviewRegion.appendChild(banner);

    const note = document.createElement('p');
    note.className = 'pdf-preview-note';
    note.textContent = 'Pages are rasterized into flat PNG images with all PDF metadata stripped so redacted text cannot be copied from underneath. Drag across any page below to add manual black redaction boxes.';
    pdfPreviewRegion.appendChild(note);

    const grid = document.createElement('div');
    grid.className = 'pdf-preview-grid';

    for (const preview of out.previews) {
      const card = document.createElement('div');
      card.className = 'pdf-page-card';

      const label = document.createElement('div');
      label.className = 'pdf-page-label';
      const manualCount = (manualBoxes[preview.pageNumber] || []).length;
      label.innerHTML = `<span>Page ${preview.pageNumber}</span><span>${manualCount > 0 ? `${manualCount} manual box(es)` : 'Drag to redact'}</span>`;

      const wrap = document.createElement('div');
      wrap.className = 'pdf-canvas-wrap';

      const img = document.createElement('img');
      img.className = 'pdf-page-img';
      img.src = preview.dataUrl;
      img.alt = `Redacted preview of page ${preview.pageNumber}`;
      wrap.appendChild(img);

      attachManualDrawing(wrap, preview.pageNumber);
      card.appendChild(label);
      card.appendChild(wrap);
      grid.appendChild(card);
    }

    pdfPreviewRegion.appendChild(grid);
  }

  async function runPdfRedaction(syncTextarea = true) {
    if (!loadedPdfBytes || !pdfPreviewRegion) return;
    const runId = ++pdfRunId;

    pdfPreviewRegion.hidden = false;
    if (!lastPdfOutput) {
      pdfPreviewRegion.innerHTML = '<div class="output-placeholder">Rendering and redacting PDF locally in your browser…</div>';
    }

    try {
      const out = await redactPdfDocument(
        loadedPdfBytes,
        getActiveRules(),
        getCustomTerms(),
        manualBoxes
      );
      if (runId !== pdfRunId) return;

      lastPdfOutput = out;
      renderPdfPreviews(out);
      if (syncTextarea && inputEl) {
        inputEl.value = out.extractedText;
        processRedaction();
      }
      updatePdfButtons();
    } catch (err) {
      if (runId !== pdfRunId) return;
      const msg = err instanceof Error ? err.message : 'PDF processing failed.';
      pdfPreviewRegion.innerHTML = `<div class="output-placeholder" style="color: #ef4444;">${escapeHtml(msg)}</div>`;
      lastPdfOutput = null;
      updatePdfButtons();
      showToast(msg);
    }
  }

  async function loadPdfFile(file: File) {
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Please select a PDF file (.pdf).');
      return;
    }
    const buf = await file.arrayBuffer();
    loadedPdfBytes = new Uint8Array(buf);
    loadedPdfName = file.name || 'document.pdf';
    manualBoxes = {};
    manualHistory = [];
    lastPdfOutput = null;
    updatePdfButtons();
    await runPdfRedaction(true);
    showToast(`Redacted ${loadedPdfName} locally.`);
  }

  if (pdfDropzone && pdfFileInput) {
    pdfDropzone.addEventListener('click', () => pdfFileInput.click());
    pdfDropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pdfFileInput.click();
      }
    });
    pdfDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      pdfDropzone.classList.add('dragging');
    });
    pdfDropzone.addEventListener('dragleave', () => {
      pdfDropzone.classList.remove('dragging');
    });
    pdfDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      pdfDropzone.classList.remove('dragging');
      const file = e.dataTransfer?.files?.[0];
      if (file) void loadPdfFile(file);
    });
    pdfFileInput.addEventListener('change', () => {
      const file = pdfFileInput.files?.[0];
      if (file) void loadPdfFile(file);
      pdfFileInput.value = '';
    });
  }

  if (samplePdfBtn) {
    samplePdfBtn.addEventListener('click', async () => {
      if (customTermsEl && !customTermsEl.value.trim()) {
        customTermsEl.value = 'Alice Cooper, SovereignCorp, Project Titan';
      }
      loadedPdfBytes = await createSampleConfidentialPdf();
      loadedPdfName = 'sample-confidential-nda.pdf';
      manualBoxes = {};
      manualHistory = [];
      lastPdfOutput = null;
      updatePdfButtons();
      await runPdfRedaction(true);
      showToast('Loaded and redacted sample PDF.');
    });
  }

  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', () => {
      if (!lastPdfOutput) return;
      const bytes = new Uint8Array(lastPdfOutput.pdfBytes);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base = loadedPdfName.replace(/\.pdf$/i, '');
      a.download = `${base}-redacted.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Downloaded flattened redacted PDF.');
    });
  }

  if (undoManualBtn) {
    undoManualBtn.addEventListener('click', () => {
      const pageNum = manualHistory.pop();
      if (pageNum === undefined) return;
      manualBoxes[pageNum]?.pop();
      updatePdfButtons();
      void runPdfRedaction(false);
      showToast('Removed last manual redaction box.');
    });
  }

  if (clearPdfBtn) {
    clearPdfBtn.addEventListener('click', () => {
      loadedPdfBytes = null;
      loadedPdfName = 'document.pdf';
      lastPdfOutput = null;
      manualBoxes = {};
      manualHistory = [];
      if (pdfPreviewRegion) {
        pdfPreviewRegion.innerHTML = '';
        pdfPreviewRegion.hidden = true;
      }
      updatePdfButtons();
      showToast('Cleared PDF preview.');
    });
  }

  if (inputEl) {
    inputEl.addEventListener('input', processRedaction);
  }

  let termsTimer: number | undefined;
  if (customTermsEl) {
    customTermsEl.addEventListener('input', () => {
      processRedaction();
      if (loadedPdfBytes) {
        window.clearTimeout(termsTimer);
        termsTimer = window.setTimeout(() => void runPdfRedaction(false), 200);
      }
    });
  }

  [ruleEmail, rulePhone, ruleSsn, ruleFin, ruleKey].forEach(cb => {
    if (cb) {
      cb.addEventListener('change', () => {
        processRedaction();
        if (loadedPdfBytes) void runPdfRedaction(false);
      });
    }
  });

  if (sampleBtn && inputEl && customTermsEl) {
    sampleBtn.addEventListener('click', () => {
      customTermsEl.value = 'Alice Cooper, SovereignCorp, Project Titan';
      inputEl.value = `MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis Agreement is entered into by SovereignCorp and Alice Cooper regarding Project Titan.\n\nPrimary Representative Contact:\nDirect Email: alice.cooper@example.com\nEmergency Line: +1 (555) 432-8765\nTax ID: 987-65-4321\nCorporate Wire: BE68 5390 0754 7034\nIntegration Access Token: sec_live_98a7c6f5e4d3c2b1\n\nAll disclosures under Project Titan remain strictly confidential.`;
      processRedaction();
      if (loadedPdfBytes) void runPdfRedaction(false);
      showToast('Loaded sample confidential contract.');
    });
  }

  if (clearBtn && inputEl && customTermsEl && outputRegion) {
    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      customTermsEl.value = '';
      processRedaction();
      if (loadedPdfBytes) void runPdfRedaction(false);
      showToast('Cleared input.');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!lastRedactedText) {
        showToast('Nothing to copy. Enter text first.');
        return;
      }
      await navigator.clipboard.writeText(lastRedactedText);
      showToast('Copied sanitized text to clipboard!');
    });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
