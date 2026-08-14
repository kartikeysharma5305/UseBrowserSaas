import { renderToStaticMarkup } from '../dashboard/node_modules/react-dom/server.js';
import React from '../dashboard/node_modules/react/index.js';
import { describe, expect, it } from 'vitest';

import { ResultMarkdown } from '../dashboard/src/components/dashboard/result-markdown';

function render(content: string) {
  return renderToStaticMarkup(React.createElement(ResultMarkdown, { content }));
}

describe('final Run result Markdown presentation', () => {
  it('renders plain text as a readable paragraph', () => {
    expect(render('A complete plain-text result.')).toContain(
      '<p>A complete plain-text result.</p>'
    );
  });

  it('renders bold and italic text without exposing Markdown punctuation', () => {
    const html = render('This is **important** and *helpful*.');
    expect(html).toContain('<strong');
    expect(html).toContain('<em>helpful</em>');
    expect(html).not.toContain('**important**');
  });

  it('renders result headings beneath the page section heading', () => {
    const html = render('# Page title\n\n## Summary');
    expect(html).toContain('<h3');
    expect(html).toContain('<h4');
  });

  it('renders ordered lists with semantic numbering', () => {
    const html = render('1. First item\n2. Second item');
    expect(html).toContain('<ol');
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it('renders nested bullet lists with consistent semantic nesting', () => {
    const html = render('- Parent\n  - Child one\n  - Child two');
    expect(html.match(/<ul/g)).toHaveLength(2);
    expect(html).toContain('Child one');
  });

  it('opens only HTTP links in a protected new tab', () => {
    const html = render('[MDN](https://developer.mozilla.org/en-US/docs/Web)');
    expect(html).toContain(
      'href="https://developer.mozilla.org/en-US/docs/Web"'
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');

    const unsafe = render('[unsafe](javascript:alert(1))');
    expect(unsafe).not.toContain('href=');
  });

  it('renders fenced code as inert, horizontally scrollable code', () => {
    const html = render('```js\nconst value = "<safe>";\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('&lt;safe&gt;');
  });

  it('contains long URLs inside the result width on mobile', () => {
    const html = render(
      `[source](https://example.com/${'segment/'.repeat(60)})`
    );
    expect(html).toContain('max-w-3xl');
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('break-all');
  });

  it('escapes unsafe HTML rather than interpreting it', () => {
    const html = render('<script>alert("unsafe")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('degrades safely for empty and malformed Markdown', () => {
    expect(render('   ')).toContain('No result captured.');
    expect(render('Unclosed **bold marker')).toContain('**bold marker');
  });
});
