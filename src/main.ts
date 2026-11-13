import { initTheme } from './theme.ts';
import { initModals } from './modals.ts';
import { showToast } from './toast.ts';
import { auditCookies } from './cookies.ts';
import { auditVault } from './vault.ts';
import { sanitizeText } from './calc.ts';

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

  const ruleEmail = document.getElementById('rule-email') as HTMLInputElement | null;
  const rulePhone = document.getElementById('rule-phone') as HTMLInputElement | null;
  const ruleSsn = document.getElementById('rule-ssn') as HTMLInputElement | null;
  const ruleFin = document.getElementById('rule-financial') as HTMLInputElement | null;
  const ruleKey = document.getElementById('rule-apikey') as HTMLInputElement | null;

  let lastRedactedText = '';

  function processRedaction() {
    if (!outputRegion) return;
    const text = inputEl ? inputEl.value : '';

    if (!text.trim()) {
      outputRegion.innerHTML = '<div class="output-placeholder">Enter document text above to view instant pattern sanitization and redacted text.</div>';
      lastRedactedText = '';
      return;
    }

    const activeRules: string[] = [];
    if (ruleEmail?.checked) activeRules.push('email');
    if (rulePhone?.checked) activeRules.push('phone');
    if (ruleSsn?.checked) activeRules.push('ssn-id');
    if (ruleFin?.checked) activeRules.push('credit-card');
    if (ruleKey?.checked) activeRules.push('api-key');

    const customTerms = customTermsEl?.value
      ? customTermsEl.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const res = sanitizeText(text, activeRules, customTerms);
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

  [inputEl, customTermsEl].forEach(el => {
    if (el) el.addEventListener('input', processRedaction);
  });

  [ruleEmail, rulePhone, ruleSsn, ruleFin, ruleKey].forEach(cb => {
    if (cb) cb.addEventListener('change', processRedaction);
  });

  if (sampleBtn && inputEl && customTermsEl) {
    sampleBtn.addEventListener('click', () => {
      customTermsEl.value = 'Alice Cooper, SovereignCorp, Project Titan';
      inputEl.value = `MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis Agreement is entered into by SovereignCorp and Alice Cooper regarding Project Titan.\n\nPrimary Representative Contact:\nDirect Email: alice.cooper@example.com\nEmergency Line: +1 (555) 432-8765\nTax ID: 987-65-4321\nCorporate Wire: BE68 5390 0754 7034\nIntegration Access Token: sec_live_98a7c6f5e4d3c2b1\n\nAll disclosures under Project Titan remain strictly confidential.`;
      processRedaction();
      showToast('Loaded sample confidential contract.');
    });
  }

  if (clearBtn && inputEl && customTermsEl && outputRegion) {
    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      customTermsEl.value = '';
      processRedaction();
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
