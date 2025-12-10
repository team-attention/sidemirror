/**
 * Markdown Preview Component
 *
 * Renders markdown content with diff highlighting and inline comments.
 */

import { escapeHtml } from '../../utils/dom';

export interface MarkdownComment {
  id: string;
  line: number;
  endLine?: number;
  text: string;
  isSubmitted?: boolean;
  colorIndex?: number;
}

export interface DeletionInfo {
  afterLine: number;
  content: string;
}

declare global {
  interface Window {
    SidecarHighlighter?: {
      highlightCodeBlock: (code: string, lang: string) => Promise<string>;
      highlightLines: (lines: string[], language: string) => Promise<string[]>;
      getLanguageFromPath: (path: string) => string;
    };
  }
}

/**
 * Highlight code using Shiki
 */
async function highlightCodeAsync(code: string, lang: string): Promise<string> {
  if (window.SidecarHighlighter && lang) {
    try {
      return await window.SidecarHighlighter.highlightCodeBlock(code, lang);
    } catch (e) {
      console.warn('Code highlighting failed:', e);
    }
  }
  return escapeHtml(code);
}

/**
 * Process inline markdown formatting
 */
export function processInline(text: string): string {
  const placeholders: string[] = [];
  let result = text.replace(/\{\{INLINE_CODE_(\d+)\}\}/g, (match) => {
    const index = placeholders.length;
    placeholders.push(match);
    return '\x00PLACEHOLDER' + index + '\x00';
  });

  result = escapeHtml(result);

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Links
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank">$1</a>'
  );

  placeholders.forEach((placeholder, i) => {
    result = result.replace('\x00PLACEHOLDER' + i + '\x00', placeholder);
  });

  return result;
}

/**
 * Render markdown table
 */
export function renderTable(rows: string[]): string {
  if (rows.length === 0) return '';

  const parseRow = (row: string) => {
    return row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
  };

  const hasSeparator = rows.length > 1 && /^\|[\s:|-]+\|$/.test(rows[1]);
  const headerRow = parseRow(rows[0]);
  let alignments: string[] = [];

  let dataStartIndex = 1;
  if (hasSeparator) {
    const separatorCells = parseRow(rows[1]);
    alignments = separatorCells.map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });
    dataStartIndex = 2;
  }

  let tableHtml = '<table>';

  tableHtml += '<thead><tr>';
  headerRow.forEach((cell, i) => {
    const align = alignments[i] ? ` style="text-align: ${alignments[i]}"` : '';
    tableHtml += `<th${align}>${processInline(cell)}</th>`;
  });
  tableHtml += '</tr></thead>';

  if (rows.length > dataStartIndex) {
    tableHtml += '<tbody>';
    for (let i = dataStartIndex; i < rows.length; i++) {
      const cells = parseRow(rows[i]);
      tableHtml += '<tr>';
      cells.forEach((cell, j) => {
        const align = alignments[j] ? ` style="text-align: ${alignments[j]}"` : '';
        tableHtml += `<td${align}>${processInline(cell)}</td>`;
      });
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody>';
  }

  tableHtml += '</table>';
  return tableHtml;
}

/**
 * Check if a line is an HTML tag or contains HTML elements
 */
function isHtmlLine(line: string): boolean {
  const trimmed = line.trim();
  // Self-closing tags: <br />, <img ... />, <hr />
  if (/^<\w+[^>]*\/>\s*$/.test(trimmed)) return true;
  // Opening HTML tags: <div>, <table>, <tr>, <td>, <img>, <a>, <details>, <summary>
  if (/^<(div|table|tr|td|th|thead|tbody|img|a|br|hr|details|summary|center|span)\b[^>]*>/.test(trimmed)) return true;
  // Closing HTML tags: </div>, </table>, etc.
  if (/^<\/(div|table|tr|td|th|thead|tbody|a|details|summary|center|span)>/.test(trimmed)) return true;
  // Lines that are primarily HTML (start with < and end with >)
  if (/^<[^>]+>.*<\/[^>]+>$/.test(trimmed)) return true;
  return false;
}

/**
 * Render markdown to HTML
 */
export async function renderMarkdown(text: string): Promise<string> {
  const codeBlockData: Array<{ lang: string; code: string }> = [];
  let html = text.replace(
    /```([\w+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g,
    (_match, lang, code) => {
      const index = codeBlockData.length;
      codeBlockData.push({ lang, code: code.trim() });
      return '\n{{CODE_BLOCK_' + index + '}}\n';
    }
  );

  const highlightedBlocks = await Promise.all(
    codeBlockData.map(async ({ lang, code }) => {
      const highlighted = await highlightCodeAsync(code, lang);
      return `<pre><code class="language-${lang || ''} shiki">${highlighted}</code></pre>`;
    })
  );

  const inlineCode: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCode.length;
    inlineCode.push('<code>' + escapeHtml(code) + '</code>');
    return '{{INLINE_CODE_' + index + '}}';
  });

  const lines = html.split('\n');
  const processedLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  const listStack: Array<{ type: string; indent: number }> = [];

  const closeListsToLevel = (targetLevel: number) => {
    while (listStack.length > targetLevel) {
      const closed = listStack.pop()!;
      processedLines.push(closed.type === 'ul' ? '</ul>' : '</ol>');
    }
  };

  const closeAllLists = () => closeListsToLevel(0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\{\{CODE_BLOCK_\d+\}\}$/.test(line.trim())) {
      closeAllLists();
      if (inTable) {
        processedLines.push(renderTable(tableRows));
        tableRows = [];
        inTable = false;
      }
      processedLines.push(line.trim());
      continue;
    }

    if (/^\|.*\|$/.test(line.trim())) {
      closeAllLists();
      inTable = true;
      tableRows.push(line.trim());
      continue;
    } else if (inTable) {
      processedLines.push(renderTable(tableRows));
      tableRows = [];
      inTable = false;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeAllLists();
      processedLines.push('<hr>');
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeAllLists();
      const content = line.replace(/^>\s?/, '');
      processedLines.push('<blockquote><p>' + processInline(content) + '</p></blockquote>');
      continue;
    }

    if (/^#{1,6} /.test(line)) {
      closeAllLists();
      const level = line.match(/^(#+)/)![1].length;
      const content = line.replace(/^#+\s*/, '');
      processedLines.push(`<h${level}>${escapeHtml(content)}</h${level}>`);
      continue;
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      const content = ulMatch[2];

      if (listStack.length > indent + 1) {
        closeListsToLevel(indent + 1);
      }

      if (listStack.length === 0 || listStack.length <= indent) {
        while (listStack.length <= indent) {
          processedLines.push('<ul>');
          listStack.push({ type: 'ul', indent: listStack.length });
        }
      }

      const checkboxMatch = content.match(/^\[([xX\s])\]\s+(.*)$/);
      if (checkboxMatch) {
        const isChecked = checkboxMatch[1].toLowerCase() === 'x';
        const taskContent = checkboxMatch[2];
        const checkbox = `<input type="checkbox"${isChecked ? ' checked' : ''} disabled>`;
        processedLines.push(
          `<li class="task-list-item">${checkbox}${processInline(taskContent)}</li>`
        );
      } else {
        processedLines.push('<li>' + processInline(content) + '</li>');
      }
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      const indent = Math.floor(olMatch[1].length / 2);
      const content = olMatch[2];

      if (listStack.length > indent + 1) {
        closeListsToLevel(indent + 1);
      }

      if (listStack.length === 0 || listStack.length <= indent) {
        while (listStack.length <= indent) {
          processedLines.push('<ol>');
          listStack.push({ type: 'ol', indent: listStack.length });
        }
      }

      processedLines.push('<li>' + processInline(content) + '</li>');
      continue;
    }

    if (line.trim() === '') {
      let nextNonEmptyLine: string | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextNonEmptyLine = lines[j];
          break;
        }
      }

      const isNextRootListItem =
        nextNonEmptyLine &&
        (/^\d+\.\s+/.test(nextNonEmptyLine) || /^[-*+]\s+/.test(nextNonEmptyLine));

      if (isNextRootListItem && listStack.length > 0) {
        closeListsToLevel(1);
      } else {
        closeAllLists();
      }
      processedLines.push('');
      continue;
    }

    // Check if line contains HTML - pass through without escaping
    if (isHtmlLine(line)) {
      closeAllLists();
      processedLines.push(line);
      continue;
    }

    closeAllLists();
    processedLines.push(processInline(line));
  }

  closeAllLists();

  if (inTable && tableRows.length > 0) {
    processedLines.push(renderTable(tableRows));
  }

  html = processedLines.join('\n');

  highlightedBlocks.forEach((block, i) => {
    html = html.replace('{{CODE_BLOCK_' + i + '}}', block);
  });
  inlineCode.forEach((code, i) => {
    html = html.replace('{{INLINE_CODE_' + i + '}}', code);
  });

  // Wrap paragraphs
  const blockTags = [
    '<h1', '<h2', '<h3', '<h4', '<h5', '<h6',
    '<ul', '<ol', '<li', '<pre', '<hr', '<blockquote',
    '</ul', '</ol', '</li', '</blockquote', '<table', '</table',
    '<div', '</div', '<img', '<br', '<a ', '</a>',
    '<details', '</details', '<summary', '</summary',
    '<center', '</center', '<span', '</span',
    '<tr', '</tr', '<td', '</td', '<th', '</th',
    '<thead', '</thead', '<tbody', '</tbody',
  ];
  const finalLines = html.split('\n');
  let result = '';
  const paragraphBuffer: string[] = [];
  let inPreBlock = false;

  for (const line of finalLines) {
    const trimmed = line.trim();

    if (trimmed.includes('<pre')) {
      inPreBlock = true;
    }

    if (inPreBlock) {
      if (paragraphBuffer.length > 0) {
        result += '<p>' + paragraphBuffer.join('<br>') + '</p>\n';
        paragraphBuffer.length = 0;
      }
      result += line + '\n';
      if (line.includes('</pre>')) {
        inPreBlock = false;
      }
      continue;
    }

    if (trimmed === '') {
      if (paragraphBuffer.length > 0) {
        result += '<p>' + paragraphBuffer.join('<br>') + '</p>\n';
        paragraphBuffer.length = 0;
      }
    } else if (blockTags.some((tag) => trimmed.startsWith(tag))) {
      if (paragraphBuffer.length > 0) {
        result += '<p>' + paragraphBuffer.join('<br>') + '</p>\n';
        paragraphBuffer.length = 0;
      }
      result += trimmed + '\n';
    } else {
      paragraphBuffer.push(trimmed);
    }
  }
  if (paragraphBuffer.length > 0) {
    result += '<p>' + paragraphBuffer.join('<br>') + '</p>';
  }

  return result;
}

/**
 * Render preview comment box
 */
function renderPreviewCommentBox(comment: MarkdownComment): string {
  const isPending = !comment.isSubmitted;
  const statusClass = isPending ? 'pending' : 'submitted';
  const colorIndex = comment.colorIndex ?? 0;
  const lineDisplay =
    comment.line === (comment.endLine || comment.line)
      ? `Line ${comment.line}`
      : `Lines ${comment.line}-${comment.endLine || comment.line}`;

  return `
    <div class="preview-comment-box ${statusClass} color-${colorIndex}" data-comment-id="${comment.id}">
      <div class="preview-comment-header">
        <span class="comment-location">${lineDisplay}</span>
        ${
          isPending
            ? `
          <div class="inline-comment-actions">
            <button class="btn-icon" onclick="startPreviewCommentEdit('${comment.id}')" title="Edit">✎</button>
            <button class="btn-icon btn-danger" onclick="deleteComment('${comment.id}')" title="Delete">🗑</button>
          </div>
        `
            : `
          <span class="submitted-label">submitted</span>
        `
        }
      </div>
      <div class="preview-comment-body" id="preview-body-${comment.id}">${escapeHtml(comment.text)}</div>
      <div class="preview-comment-edit" id="preview-edit-${comment.id}" style="display: none;">
        <textarea class="comment-textarea">${escapeHtml(comment.text)}</textarea>
        <div class="comment-form-actions">
          <button class="btn-secondary" onclick="cancelPreviewCommentEdit('${comment.id}')">Cancel</button>
          <button onclick="savePreviewCommentEdit('${comment.id}')">Save</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render full markdown with diff highlights
 */
export async function renderFullMarkdownWithHighlights(
  content: string,
  changedLineNumbers: number[] | undefined,
  deletions: DeletionInfo[] | undefined,
  comments: MarkdownComment[] = []
): Promise<string> {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const changedSet = new Set(changedLineNumbers || []);

  const deletionMap = new Map<number, string>();
  if (deletions) {
    for (const del of deletions) {
      deletionMap.set(del.afterLine, del.content);
    }
  }

  // Build comment maps
  const commentColorMap = new Map<string, number>();
  comments.forEach((comment, idx) => {
    commentColorMap.set(comment.id, idx % 6);
  });

  const commentsByLine = new Map<number, MarkdownComment[]>();
  comments.forEach((comment) => {
    const startLine = comment.line;
    const endLine = comment.endLine || comment.line;
    const colorIndex = commentColorMap.get(comment.id) ?? 0;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (!commentsByLine.has(lineNum)) {
        commentsByLine.set(lineNum, []);
      }
      commentsByLine.get(lineNum)!.push({ ...comment, colorIndex });
    }
  });

  interface ContentGroup {
    type: 'addition' | 'deletion' | 'normal';
    lines: string[];
    startLine: number;
  }

  const groups: ContentGroup[] = [];
  let currentGroup: ContentGroup | null = null;
  let inCodeBlock = false;

  if (deletionMap.has(0)) {
    groups.push({ type: 'deletion', lines: [deletionMap.get(0)!], startLine: 0 });
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const isChanged = changedSet.has(lineNum);
    const groupType: 'addition' | 'normal' = isChanged ? 'addition' : 'normal';

    const trimmedLine = line.trim();
    const isCodeFence = trimmedLine.startsWith('```');
    if (isCodeFence) {
      inCodeBlock = !inCodeBlock;
    }

    const isBlankLine = line.trim() === '';
    const isHeader = /^#{1,6}\s/.test(line);
    const shouldSplit =
      !inCodeBlock &&
      currentGroup &&
      currentGroup.type === groupType &&
      (isBlankLine || isHeader);

    const effectiveTypeChange =
      !inCodeBlock && currentGroup && currentGroup.type !== groupType;

    if (!currentGroup || effectiveTypeChange || shouldSplit) {
      if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
      currentGroup = { type: groupType, lines: [], startLine: lineNum };
    }
    currentGroup.lines.push(line);

    if (deletionMap.has(lineNum) && !inCodeBlock) {
      if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
      groups.push({ type: 'deletion', lines: [deletionMap.get(lineNum)!], startLine: lineNum });
      currentGroup = null;
    }
  }
  if (currentGroup) groups.push(currentGroup);

  let markdownHtml = '';

  for (const group of groups) {
    const groupContent = group.lines.join('\n');
    const rendered = await renderMarkdown(groupContent);
    const endLine = group.startLine + group.lines.length - 1;

    // Collect comment colors for this block
    const blockCommentColors = new Set<number>();
    for (let lineNum = group.startLine; lineNum <= endLine; lineNum++) {
      if (commentsByLine.has(lineNum)) {
        commentsByLine.get(lineNum)!.forEach((c) => blockCommentColors.add(c.colorIndex!));
      }
    }

    const groupComments = commentsByLine.has(endLine)
      ? commentsByLine.get(endLine)!.filter((c) => (c.endLine || c.line) === endLine)
      : [];

    const hasComment = blockCommentColors.size > 0;
    const commentClass = hasComment ? ' has-comment' : '';

    let gutterHtml = '';
    if (hasComment) {
      gutterHtml = '<div class="comment-gutter-indicators">';
      Array.from(blockCommentColors).forEach((colorIdx) => {
        gutterHtml += `<div class="comment-gutter-bar color-${colorIdx}"></div>`;
      });
      gutterHtml += '</div>';
    }

    let blockHtml = '';
    if (group.type === 'addition') {
      blockHtml = `<div class="diff-block diff-addition${commentClass}" data-start-line="${group.startLine}" data-end-line="${endLine}">${gutterHtml}${rendered}</div>`;
    } else if (group.type === 'deletion') {
      blockHtml = `<div class="diff-block diff-deletion" data-after-line="${group.startLine}">${rendered}</div>`;
    } else {
      blockHtml = `<div class="diff-block diff-normal${commentClass}" data-start-line="${group.startLine}" data-end-line="${endLine}">${gutterHtml}${rendered}</div>`;
    }

    markdownHtml += blockHtml;

    if (groupComments.length > 0 && group.type !== 'deletion') {
      markdownHtml += `<div class="preview-inline-comments" data-line="${endLine}">`;
      groupComments.forEach((c) => {
        markdownHtml += renderPreviewCommentBox(c);
      });
      markdownHtml += '</div>';
    }
  }

  // Overview ruler markers
  let markersHtml = '';
  const additionLines = changedLineNumbers || [];
  const deletionPositions = deletions ? deletions.map((d) => d.afterLine) : [];

  for (const lineNum of additionLines) {
    const topPercent = ((lineNum - 1) / totalLines) * 100;
    markersHtml += `<div class="overview-marker addition" style="top: ${topPercent.toFixed(2)}%;"></div>`;
  }

  for (const afterLine of deletionPositions) {
    const topPercent = (afterLine / totalLines) * 100;
    markersHtml += `<div class="overview-marker deletion" style="top: ${topPercent.toFixed(2)}%;"></div>`;
  }

  comments.forEach((c) => {
    const endLine = c.endLine || c.line;
    const topPercent = ((endLine - 1) / totalLines) * 100;
    markersHtml += `<div class="overview-marker comment" style="top: ${topPercent.toFixed(2)}%;"></div>`;
  });

  return `
    <div class="markdown-preview-container">
      <div class="markdown-preview">${markdownHtml}</div>
      <div class="overview-ruler">${markersHtml}</div>
    </div>
  `;
}
