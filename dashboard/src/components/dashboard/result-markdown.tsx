import React, { Fragment, type ReactNode } from 'react';

type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

type ListItem = {
  content: InlineNode[];
  children: ListBlock[];
};

type ListBlock = {
  type: 'list';
  ordered: boolean;
  start?: number;
  items: ListItem[];
};

type ResultBlock =
  | { type: 'paragraph'; content: InlineNode[] }
  | { type: 'heading'; level: number; content: InlineNode[] }
  | { type: 'code'; language?: string; value: string }
  | ListBlock;

type ListLine = {
  indent: number;
  ordered: boolean;
  start?: number;
  content: string;
};

const INLINE_TOKEN =
  /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseInline(value: string, depth = 0): InlineNode[] {
  if (depth > 6) return [{ type: 'text', value }];

  const nodes: InlineNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, index) });
    }

    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push({ type: 'code', value: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      if (link && safeHttpUrl(link[2])) {
        nodes.push({
          type: 'link',
          href: link[2],
          children: parseInline(link[1], depth + 1),
        });
      } else {
        nodes.push({ type: 'text', value: token });
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push({
        type: 'strong',
        children: parseInline(token.slice(2, -2), depth + 1),
      });
    } else {
      nodes.push({
        type: 'emphasis',
        children: parseInline(token.slice(1, -1), depth + 1),
      });
    }
    cursor = index + token.length;
  }

  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) });
  }
  return nodes.length ? nodes : [{ type: 'text', value }];
}

function listLine(value: string): ListLine | null {
  const match = /^(\s*)(?:(\d+)\.|([-+*]))\s+(.+)$/.exec(value);
  if (!match) return null;
  return {
    indent: match[1].replaceAll('\t', '  ').length,
    ordered: Boolean(match[2]),
    start: match[2] ? Number(match[2]) : undefined,
    content: match[4],
  };
}

function parseList(
  lines: string[],
  startIndex: number,
  baseIndent: number,
  ordered: boolean
): [ListBlock, number] {
  const items: ListItem[] = [];
  let index = startIndex;
  let firstNumber: number | undefined;

  while (index < lines.length) {
    const current = listLine(lines[index]);
    if (
      !current ||
      current.indent !== baseIndent ||
      current.ordered !== ordered
    ) {
      break;
    }
    firstNumber ??= current.start;
    const contentParts = [current.content];
    const children: ListBlock[] = [];
    index += 1;

    while (index < lines.length) {
      const nested = listLine(lines[index]);
      if (nested && nested.indent > baseIndent) {
        const [child, nextIndex] = parseList(
          lines,
          index,
          nested.indent,
          nested.ordered
        );
        children.push(child);
        index = nextIndex;
        continue;
      }
      if (!nested && /^\s+\S/.test(lines[index])) {
        contentParts.push(lines[index].trim());
        index += 1;
        continue;
      }
      break;
    }

    items.push({
      content: parseInline(contentParts.join(' ')),
      children,
    });
  }

  return [
    {
      type: 'list',
      ordered,
      start: ordered ? firstNumber : undefined,
      items,
    },
    index,
  ];
}

function beginsBlock(value: string) {
  return (
    /^\s*$/.test(value) ||
    /^#{1,6}\s+/.test(value) ||
    /^\s*```/.test(value) ||
    listLine(value) !== null
  );
}

export function parseResultMarkdown(value: string): ResultBlock[] {
  const lines = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n');
  const blocks: ResultBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```([^`]*)$/.exec(line);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: 'code',
        language: fence[1].trim() || undefined,
        value: content.join('\n'),
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    const firstListLine = listLine(line);
    if (firstListLine) {
      const [list, nextIndex] = parseList(
        lines,
        index,
        firstListLine.indent,
        firstListLine.ordered
      );
      blocks.push(list);
      index = nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !beginsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      content: parseInline(paragraph.join(' ')),
    });
  }

  return blocks;
}

function InlineContent({ nodes }: { nodes: InlineNode[] }) {
  return nodes.map((node, index): ReactNode => {
    const key = `${node.type}-${index}`;
    if (node.type === 'text')
      return <Fragment key={key}>{node.value}</Fragment>;
    if (node.type === 'strong') {
      return (
        <strong
          key={key}
          className="font-semibold text-slate-950 dark:text-white"
        >
          <InlineContent nodes={node.children} />
        </strong>
      );
    }
    if (node.type === 'emphasis') {
      return (
        <em key={key}>
          <InlineContent nodes={node.children} />
        </em>
      );
    }
    if (node.type === 'code') {
      return (
        <code
          key={key}
          className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-slate-800"
        >
          {node.value}
        </code>
      );
    }
    return (
      <a
        key={key}
        href={node.href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
      >
        <InlineContent nodes={node.children} />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  });
}

function ResultList({ block }: { block: ListBlock }) {
  const List = block.ordered ? 'ol' : 'ul';
  return (
    <List
      start={block.ordered ? block.start : undefined}
      className={`space-y-2 pl-6 marker:font-medium marker:text-slate-500 ${
        block.ordered ? 'list-decimal' : 'list-disc'
      }`}
    >
      {block.items.map((item, index) => (
        <li key={index} className="pl-1">
          <InlineContent nodes={item.content} />
          {item.children.map((child, childIndex) => (
            <div key={childIndex} className="mt-2">
              <ResultList block={child} />
            </div>
          ))}
        </li>
      ))}
    </List>
  );
}

export function ResultMarkdown({
  content,
}: {
  content: string | null | undefined;
}) {
  const value = content?.trim();
  if (!value) {
    return <p className="text-sm text-slate-500">No result captured.</p>;
  }

  return (
    <div className="max-w-3xl space-y-4 break-words text-[0.95rem] leading-7 text-slate-700 [overflow-wrap:anywhere] dark:text-slate-200">
      {parseResultMarkdown(value).map((block, index) => {
        if (block.type === 'paragraph') {
          return (
            <p key={index}>
              <InlineContent nodes={block.content} />
            </p>
          );
        }
        if (block.type === 'heading') {
          const Heading =
            block.level <= 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
          return (
            <Heading
              key={index}
              className="pt-1 text-base font-semibold tracking-tight text-slate-950 first:pt-0 dark:text-white"
            >
              <InlineContent nodes={block.content} />
            </Heading>
          );
        }
        if (block.type === 'code') {
          return (
            <pre
              key={index}
              tabIndex={0}
              className="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100 dark:border-slate-700"
              aria-label={
                block.language ? `${block.language} code` : 'Code output'
              }
            >
              <code>{block.value}</code>
            </pre>
          );
        }
        return <ResultList key={index} block={block} />;
      })}
    </div>
  );
}
