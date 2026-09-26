import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { renderDocument } from './format';

describe('page rendering', () => {
  test('adds the service name as the document h1', () => {
    const html = renderDocument('test', '<main><p>body</p></main>');

    expect(html).toContain('<h1>SlashEvents</h1>');
  });

  test('does not duplicate the service h1 on the landing page', () => {
    const html = readFileSync(new URL('./landing.html', import.meta.url), 'utf8');

    expect(html.match(/<h1>/g)?.length).toBe(1);
    expect(html).toContain('<h1>SlashEvents</h1>');
    expect(html).toContain('https://blog.sequinstream.com/events-not-webhooks/');
    expect(html).toContain('<a href="/docs">docs</a>');
    expect(html).toContain('One owner, multiple projects.');
    expect(html).toContain('Source and Docker setup');
  });
});
