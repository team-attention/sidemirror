/**
 * Diff Search Component
 *
 * Search within diff content with match highlighting and navigation.
 */

import { escapeHtml } from '../../utils/dom';

export interface SearchMatch {
  cell: HTMLElement;
  cellIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface DiffSearchState {
  query: string;
  matches: SearchMatch[];
  currentIndex: number;
}

export interface DiffSearchElements {
  searchInput: HTMLInputElement;
  searchCounter: HTMLElement;
  prevButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
}

const MAX_SEARCH_MATCHES = 500;

/**
 * Perform search in diff content (supports both diff view and markdown preview)
 */
export function performDiffSearch(
  query: string,
  diffViewer: HTMLElement
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;

  const lowerQuery = query.toLowerCase();

  // Try diff view cells first
  const contentCells = diffViewer.querySelectorAll('.diff-line-content');

  if (contentCells.length > 0) {
    // Diff view mode
    contentCells.forEach((cell, cellIndex) => {
      if (matches.length >= MAX_SEARCH_MATCHES) return;

      const text = cell.textContent || '';
      const lowerText = text.toLowerCase();
      let startIndex = 0;
      let matchIndex: number;

      while ((matchIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
        if (matches.length >= MAX_SEARCH_MATCHES) break;
        matches.push({
          cell: cell as HTMLElement,
          cellIndex,
          start: matchIndex,
          end: matchIndex + lowerQuery.length,
          text: text.substring(matchIndex, matchIndex + lowerQuery.length),
        });
        startIndex = matchIndex + 1;
      }
    });
  } else {
    // Markdown preview mode - search in diff-block elements
    const diffBlocks = diffViewer.querySelectorAll('.diff-block');

    if (diffBlocks.length > 0) {
      diffBlocks.forEach((block, blockIndex) => {
        if (matches.length >= MAX_SEARCH_MATCHES) return;

        const text = block.textContent || '';
        const lowerText = text.toLowerCase();
        let startIndex = 0;
        let matchIndex: number;

        while ((matchIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
          if (matches.length >= MAX_SEARCH_MATCHES) break;
          matches.push({
            cell: block as HTMLElement,
            cellIndex: blockIndex,
            start: matchIndex,
            end: matchIndex + lowerQuery.length,
            text: text.substring(matchIndex, matchIndex + lowerQuery.length),
          });
          startIndex = matchIndex + 1;
        }
      });
    } else {
      // Fallback: search any markdown-preview content
      const markdownPreview = diffViewer.querySelector('.markdown-preview');
      if (markdownPreview) {
        const paragraphs = markdownPreview.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, code, pre');
        paragraphs.forEach((el, idx) => {
          if (matches.length >= MAX_SEARCH_MATCHES) return;

          const text = el.textContent || '';
          const lowerText = text.toLowerCase();
          let startIndex = 0;
          let matchIndex: number;

          while ((matchIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
            if (matches.length >= MAX_SEARCH_MATCHES) break;
            matches.push({
              cell: el as HTMLElement,
              cellIndex: idx,
              start: matchIndex,
              end: matchIndex + lowerQuery.length,
              text: text.substring(matchIndex, matchIndex + lowerQuery.length),
            });
            startIndex = matchIndex + 1;
          }
        });
      }
    }
  }

  return matches;
}

/**
 * Highlight all search matches
 */
export function highlightDiffMatches(matches: SearchMatch[]): void {
  const matchesByCell = new Map<HTMLElement, Array<SearchMatch & { index: number }>>();

  matches.forEach((match, index) => {
    if (!matchesByCell.has(match.cell)) {
      matchesByCell.set(match.cell, []);
    }
    matchesByCell.get(match.cell)!.push({ ...match, index });
  });

  matchesByCell.forEach((cellMatches, cell) => {
    const text = cell.textContent || '';
    const prefix = cell.dataset.prefix || '';

    // Sort by position descending to process from end
    cellMatches.sort((a, b) => b.start - a.start);

    let html = escapeHtml(text);

    cellMatches.forEach((match) => {
      const before = html.substring(0, match.start);
      const matchText = html.substring(match.start, match.end);
      const after = html.substring(match.end);
      html =
        before +
        `<span class="diff-search-match" data-match-index="${match.index}">${matchText}</span>` +
        after;
    });

    cell.innerHTML = html;
    cell.dataset.prefix = prefix;
  });
}

/**
 * Clear all search highlights
 */
export function clearDiffHighlights(diffViewer: HTMLElement): void {
  const highlights = diffViewer.querySelectorAll('.diff-search-match');
  highlights.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });
}

/**
 * Update current match highlight
 */
export function updateCurrentMatch(currentIndex: number): void {
  document.querySelectorAll('.diff-search-match.current').forEach((el) => {
    el.classList.remove('current');
  });

  const matchEl = document.querySelector(
    `.diff-search-match[data-match-index="${currentIndex}"]`
  );
  if (matchEl) {
    matchEl.classList.add('current');
    matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Navigate to next/previous match
 * Returns the new current index
 */
export function navigateDiffSearch(
  matches: SearchMatch[],
  currentIndex: number,
  direction: 1 | -1
): number {
  if (matches.length === 0) return -1;

  let newIndex = currentIndex + direction;

  if (newIndex >= matches.length) {
    newIndex = 0;
  } else if (newIndex < 0) {
    newIndex = matches.length - 1;
  }

  updateCurrentMatch(newIndex);
  return newIndex;
}

/**
 * Update navigation button states
 */
export function updateNavButtons(
  prevButton: HTMLButtonElement,
  nextButton: HTMLButtonElement,
  hasMatches: boolean
): void {
  prevButton.disabled = !hasMatches;
  nextButton.disabled = !hasMatches;
}

/**
 * Update match counter text
 */
export function updateMatchCounter(
  counterEl: HTMLElement,
  currentIndex: number,
  totalMatches: number
): void {
  if (totalMatches === 0) {
    counterEl.textContent = 'No results';
  } else {
    counterEl.textContent = `${currentIndex + 1} of ${totalMatches}`;
  }
}

/**
 * Setup diff search handlers
 */
export function setupDiffSearchHandlers(
  elements: DiffSearchElements,
  getState: () => DiffSearchState,
  onSearch: (query: string) => void,
  onNavigate: (direction: 1 | -1) => void,
  onClose: () => void,
  signal: AbortSignal
): void {
  const { searchInput, prevButton, nextButton } = elements;

  // Cmd+F / Ctrl+F to focus search
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    },
    { signal }
  );

  // Search input key handlers
  searchInput.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        onClose();
        searchInput.blur();
      } else if (e.key === 'Enter') {
        onNavigate(e.shiftKey ? -1 : 1);
      }
    },
    { signal }
  );

  // Search input change
  searchInput.addEventListener(
    'input',
    (e) => {
      onSearch((e.target as HTMLInputElement).value);
    },
    { signal }
  );

  // Navigation buttons
  prevButton.addEventListener('click', () => onNavigate(-1), { signal });
  nextButton.addEventListener('click', () => onNavigate(1), { signal });
}

/**
 * Get diff search elements
 */
export function getDiffSearchElements(): DiffSearchElements | null {
  const searchInput = document.getElementById(
    'diff-search-input'
  ) as HTMLInputElement | null;
  const searchCounter = document.getElementById('diff-search-count');
  const prevButton = document.getElementById(
    'diff-search-prev'
  ) as HTMLButtonElement | null;
  const nextButton = document.getElementById(
    'diff-search-next'
  ) as HTMLButtonElement | null;

  if (!searchInput || !searchCounter || !prevButton || !nextButton) {
    return null;
  }

  return { searchInput, searchCounter, prevButton, nextButton };
}
