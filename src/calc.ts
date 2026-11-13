// PDF redaction & sanitization engine
// In-browser text sanitization, pattern detection, and coordinate masking

export interface RedactionRule {
  id: string;
  name: string;
  pattern: RegExp;
  maskReplacement: string;
}

export const DEFAULT_RULES: RedactionRule[] = [
  {
    id: 'email',
    name: 'Email Addresses',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    maskReplacement: '[REDACTED EMAIL]',
  },
  {
    id: 'phone',
    name: 'Phone Numbers',
    pattern: /(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    maskReplacement: '[REDACTED PHONE]',
  },
  {
    id: 'ssn-id',
    name: 'Social Security / National ID',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b|\b\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}\b/g,
    maskReplacement: '[REDACTED ID]',
  },
  {
    id: 'credit-card',
    name: 'Credit Card / IBAN',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    maskReplacement: '[REDACTED FINANCIAL]',
  },
  {
    id: 'api-key',
    name: 'API Keys & Secrets',
    pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|sec_live_[a-zA-Z0-9]{16,})\b/g,
    maskReplacement: '[REDACTED API KEY]',
  },
];

export interface RedactionMatch {
  ruleId: string;
  ruleName: string;
  match: string;
  index: number;
}

export interface RedactionResult {
  originalText: string;
  redactedText: string;
  matches: RedactionMatch[];
  totalRedactions: number;
}

export function sanitizeText(text: string, activeRules: string[] = DEFAULT_RULES.map(r => r.id), customTerms: string[] = []): RedactionResult {
  if (!text) {
    return { originalText: '', redactedText: '', matches: [], totalRedactions: 0 };
  }

  let sanitized = text;
  const matches: RedactionMatch[] = [];

  // 1. Apply active built-in regex rules
  for (const rule of DEFAULT_RULES) {
    if (!activeRules.includes(rule.id)) continue;

    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        ruleId: rule.id,
        ruleName: rule.name,
        match: match[0],
        index: match.index,
      });
    }

    sanitized = sanitized.replace(rule.pattern, rule.maskReplacement);
  }

  // 2. Apply user custom terms
  for (const term of customTerms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const customRegex = new RegExp(`\\b${escaped}\\b`, 'gi');

    let match: RegExpExecArray | null;
    while ((match = customRegex.exec(text)) !== null) {
      matches.push({
        ruleId: 'custom',
        ruleName: 'Custom Term',
        match: match[0],
        index: match.index,
      });
    }

    sanitized = sanitized.replace(customRegex, '[REDACTED]');
  }

  return {
    originalText: text,
    redactedText: sanitized,
    matches,
    totalRedactions: matches.length,
  };
}
