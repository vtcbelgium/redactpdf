import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readPublic = (name: string) =>
  readFileSync(resolve(__dirname, '../public', name), 'utf-8');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

describe('RedactPDF vitals assets', () => {
  describe('public/_headers', () => {
    const headers = readPublic('_headers');

    it('applies security headers to every path', () => {
      expect(headers).toContain('/*');
    });

    it('sets HSTS, nosniff, frame and referrer protections', () => {
      expect(headers).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
      expect(headers).toContain('X-Content-Type-Options: nosniff');
      expect(headers).toContain('X-Frame-Options: DENY');
      expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    });
  });

  describe('public/sitemap.xml', () => {
    const sitemap = readPublic('sitemap.xml');

    it('is a valid XML urlset document', () => {
      expect(sitemap.trimStart().startsWith('<?xml')).toBe(true);
      expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(sitemap).toContain('</urlset>');

      const doc = new DOMParser().parseFromString(sitemap, 'application/xml');
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(doc.documentElement.tagName).toBe('urlset');
    });

    it('lists the canonical site URL', () => {
      expect(sitemap).toContain('<loc>https://redactpdf.othrys.be/</loc>');
    });
  });

  describe('public/robots.txt', () => {
    const robots = readPublic('robots.txt');

    it('allows crawling and references the sitemap', () => {
      expect(robots).toContain('User-agent: *');
      expect(robots).toContain('Allow: /');
      expect(robots).toContain('Sitemap: https://redactpdf.othrys.be/sitemap.xml');
    });
  });

  describe('public/og-image.svg', () => {
    const ogImage = readPublic('og-image.svg');

    it('is a local 1200x630 SVG social card with no remote assets', () => {
      expect(ogImage).toContain('<svg');
      expect(ogImage).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(ogImage).toContain('width="1200"');
      expect(ogImage).toContain('height="630"');
      expect(ogImage).toContain('viewBox="0 0 1200 630"');
      expect(ogImage).not.toContain('<script');
      expect(ogImage).not.toMatch(/href=["']https?:/i);
      expect(ogImage).not.toContain('@import');
    });
  });

  describe('index.html', () => {
    it('exposes Open Graph and Twitter social tags', () => {
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:type" content="website"');
      expect(html).toContain('property="og:url" content="https://redactpdf.othrys.be/"');
      expect(html).toContain('property="og:image" content="https://redactpdf.othrys.be/og-image.svg"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('name="twitter:image" content="https://redactpdf.othrys.be/og-image.svg"');
    });

    it('keeps WebApplication JSON-LD and adds a valid FAQPage block', () => {
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      const schemas = blocks.map((match) => JSON.parse(match[1]) as { '@type': string });

      expect(schemas.some((schema) => schema['@type'] === 'WebApplication')).toBe(true);

      const faq = schemas.find((schema) => schema['@type'] === 'FAQPage') as
        | { '@type': string; mainEntity: unknown[] }
        | undefined;
      expect(faq).toBeDefined();
      expect(faq?.mainEntity).toHaveLength(3);
      expect(html).toContain('"@type": "Question"');
    });

    it('makes no Person claim and no anti-ad promise', () => {
      expect(html).not.toContain('"Person"');
      expect(html).not.toMatch(/\b(?:zero|never)\s+ads\b/i);
      expect(html).not.toMatch(/ad[-\s]?free/i);
    });
  });
});
