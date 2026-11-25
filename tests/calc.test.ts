import { describe, it, expect } from 'vitest';
import { sanitizeText, findRedactionSpans, DEFAULT_RULES } from '../src/calc.ts';

describe('RedactPDF Sanitizer Logic', () => {
  it('returns empty result on empty string', () => {
    const res = sanitizeText('');
    expect(res.totalRedactions).toBe(0);
    expect(res.redactedText).toBe('');
  });

  it('redacts email addresses', () => {
    const raw = 'Please contact jeroen@othrys.be for security reviews.';
    const res = sanitizeText(raw, ['email']);
    expect(res.totalRedactions).toBe(1);
    expect(res.redactedText).toContain('[REDACTED EMAIL]');
    expect(res.redactedText).not.toContain('jeroen@othrys.be');
  });

  it('redacts live API keys & secrets', () => {
    const raw = 'Found token ghp_1234567890abcdefghijklmnopqrst and key sec_live_1234567890abcdef in header.';
    const res = sanitizeText(raw, ['api-key']);
    expect(res.totalRedactions).toBe(2);
    expect(res.redactedText).not.toContain('ghp_1234567890');
    expect(res.redactedText).toContain('[REDACTED API KEY]');
  });

  it('redacts IBAN numbers with spaces without misclassifying as phone', () => {
    const raw = 'Please transfer to IBAN BE68 5390 0754 7034 before noon.';
    const res = sanitizeText(raw, ['credit-card', 'phone']);
    expect(res.totalRedactions).toBe(1);
    expect(res.redactedText).toContain('[REDACTED FINANCIAL]');
    expect(res.redactedText).not.toContain('[REDACTED PHONE]');
    expect(res.redactedText).not.toContain('BE68 5390 0754 7034');
  });

  it('redacts custom user terms', () => {
    const raw = 'Contract signed by John Doe on behalf of Acme Corp.';
    const res = sanitizeText(raw, [], ['John Doe', 'Acme Corp']);
    expect(res.totalRedactions).toBe(2);
    expect(res.redactedText).toBe('Contract signed by [REDACTED] on behalf of [REDACTED].');
  });

  it('redacts full NDA sample cleanly without stray + or IBAN misclassification', () => {
    const raw = `MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis Agreement is entered into by SovereignCorp and Alice Cooper regarding Project Titan.\n\nPrimary Representative Contact:\nDirect Email: alice.cooper@example.com\nEmergency Line: +1 (555) 432-8765\nTax ID: 987-65-4321\nCorporate Wire: BE68 5390 0754 7034\nIntegration Access Token: sec_live_98a7c6f5e4d3c2b1\n\nAll disclosures under Project Titan remain strictly confidential.`;
    const res = sanitizeText(
      raw,
      DEFAULT_RULES.map(r => r.id),
      ['Alice Cooper', 'SovereignCorp', 'Project Titan']
    );

    expect(res.redactedText).toContain('Direct Email: [REDACTED EMAIL]');
    expect(res.redactedText).toContain('Emergency Line: [REDACTED PHONE]');
    expect(res.redactedText).not.toContain('+[REDACTED PHONE]');
    expect(res.redactedText).toContain('Tax ID: [REDACTED ID]');
    expect(res.redactedText).toContain('Corporate Wire: [REDACTED FINANCIAL]');
    expect(res.redactedText).not.toContain('BE[REDACTED PHONE]');
    expect(res.redactedText).toContain('Integration Access Token: [REDACTED API KEY]');
    expect(res.redactedText).not.toContain('Alice Cooper');
    expect(res.redactedText).not.toContain('SovereignCorp');
    expect(res.redactedText).not.toContain('Project Titan');
    expect(res.redactedText).toContain('[REDACTED]');
  });

  it('returns accurate non-overlapping spans for PDF coordinate redaction', () => {
    const raw = 'Email alice.cooper@example.com, Wire BE68 5390 0754 7034, Phone +1 (555) 432-8765, Lead Alice Cooper.';
    const spans = findRedactionSpans(
      raw,
      DEFAULT_RULES.map(r => r.id),
      ['Alice Cooper']
    );

    expect(spans.map(s => s.match)).toEqual([
      'alice.cooper@example.com',
      'BE68 5390 0754 7034',
      '+1 (555) 432-8765',
      'Alice Cooper',
    ]);
    for (let i = 0; i < spans.length; i++) {
      expect(raw.slice(spans[i].start, spans[i].end)).toBe(spans[i].match);
      if (i > 0) {
        expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
      }
    }
  });
});
