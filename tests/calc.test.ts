import { describe, it, expect } from 'vitest';
import { sanitizeText, DEFAULT_RULES } from '../src/calc.ts';

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

  it('redacts custom user terms', () => {
    const raw = 'Contract signed by John Doe on behalf of Acme Corp.';
    const res = sanitizeText(raw, [], ['John Doe', 'Acme Corp']);
    expect(res.totalRedactions).toBe(2);
    expect(res.redactedText).toBe('Contract signed by [REDACTED] on behalf of [REDACTED].');
  });
});
