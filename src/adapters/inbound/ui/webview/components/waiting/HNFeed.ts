/**
 * Hacker News Feed Component
 *
 * Renders Hacker News stories in the webview.
 * Used in waiting screen and feed toggle.
 */

import { escapeHtml } from '../../utils/dom';

/**
 * Domains known to block iframe embedding via X-Frame-Options or CSP.
 * These will be marked with an external link indicator.
 */
const IFRAME_BLOCKED_DOMAINS = new Set([
  'github.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
  'youtube.com',
  'medium.com',
  'nytimes.com',
  'wsj.com',
  'bloomberg.com',
  'washingtonpost.com',
  'reddit.com',
  'instagram.com',
  'stackoverflow.com',
  'apple.com',
  'google.com',
  'docs.google.com',
  'drive.google.com',
  'amazon.com',
  'notion.so',
  'figma.com',
  'dropbox.com',
  'pinterest.com',
  'tumblr.com',
  'quora.com',
  'substack.com',
]);

/**
 * Check if a domain blocks iframe embedding
 */
function isIframeBlocked(domain: string | undefined): boolean {
  if (!domain) return false;
  const lowerDomain = domain.toLowerCase();
  // Check exact match or subdomain match
  for (const blocked of IFRAME_BLOCKED_DOMAINS) {
    if (lowerDomain === blocked || lowerDomain.endsWith('.' + blocked)) {
      return true;
    }
  }
  return false;
}

export interface HNStory {
  id: number;
  title: string;
  url: string;
  discussionUrl: string;
  score: number;
  descendants: number;
  domain?: string;
  timeAgo: string;
}

export type HNFeedStatus = 'idle' | 'loading' | 'error';

/**
 * Render a single HN story item
 */
function renderHNStory(story: HNStory): string {
  const isBlocked = isIframeBlocked(story.domain);
  const externalIndicator = isBlocked
    ? '<span class="hn-external-indicator" title="Opens in browser">↗</span>'
    : '';
  const domainDisplay = story.domain
    ? `<span class="hn-story-domain">(${escapeHtml(story.domain)})${externalIndicator}</span>`
    : '';
  const storyUrl = story.url || story.discussionUrl;
  // Escape title for use in onclick attribute (escape both HTML and quotes)
  const escapedTitleForAttr = escapeHtml(story.title).replace(/'/g, "\\'");

  // For blocked domains, open directly in browser instead of webview
  const clickHandler = isBlocked
    ? `openHNStoryExternal('${escapeHtml(storyUrl)}')`
    : `openHNStory('${escapeHtml(storyUrl)}', '${escapedTitleForAttr}')`;

  return `
    <div class="hn-story${isBlocked ? ' hn-story-external' : ''}">
      <span class="hn-story-title" onclick="${clickHandler}" title="${escapeHtml(story.title)}">
        ${escapeHtml(story.title)}
      </span>
      <div class="hn-story-meta">
        <span class="hn-story-score">▲ ${story.score}</span>
        <span class="hn-story-comments" onclick="openHNStory('${escapeHtml(story.discussionUrl)}', '${escapedTitleForAttr} - HN Discussion')">
          💬 ${story.descendants} comments
        </span>
        ${domainDisplay}
        <span class="hn-story-time">${escapeHtml(story.timeAgo)}</span>
      </div>
    </div>
  `;
}

/**
 * Render the complete HN feed with header and stories
 */
export function renderHNFeed(
  stories: HNStory[],
  status: HNFeedStatus,
  error: string | null,
  hasMore: boolean = true,
  loadingMore: boolean = false
): string {
  const isLoading = status === 'loading';

  let content = '';

  if (status === 'loading') {
    content = `
      <div class="hn-loading">
        <div class="hn-loading-spinner"></div>
        <div>Loading stories...</div>
      </div>
    `;
  } else if (status === 'error') {
    content = `
      <div class="hn-error">
        <div class="hn-error-icon">⚠️</div>
        <div class="hn-error-message">${escapeHtml(error || 'Failed to load stories')}</div>
        <div class="hn-error-retry">
          <button class="hn-refresh-btn" onclick="refreshHNFeed()">
            <span class="refresh-icon">↻</span> Retry
          </button>
        </div>
      </div>
    `;
  } else if (!stories || stories.length === 0) {
    content = `
      <div class="hn-empty">
        <div>No stories available</div>
        <button class="hn-refresh-btn" onclick="refreshHNFeed()">
          <span class="refresh-icon">↻</span> Load Stories
        </button>
      </div>
    `;
  } else {
    const loadMoreHtml = hasMore
      ? `<div class="hn-load-more">
          <button class="hn-load-more-btn ${loadingMore ? 'loading' : ''}" onclick="loadMoreHNFeed()" ${loadingMore ? 'disabled' : ''}>
            ${loadingMore ? '<span class="hn-loading-spinner-small"></span> Loading...' : 'Load More'}
          </button>
        </div>`
      : '<div class="hn-end-of-list">No more stories</div>';

    content = `
      <div class="hn-story-list" id="hn-story-list">
        ${stories.map((story) => renderHNStory(story)).join('')}
        ${loadMoreHtml}
      </div>
    `;
  }

  return `
    <div class="hn-feed">
      <div class="hn-feed-header">
        <div class="hn-feed-title">
          <span class="hn-icon">Y</span>
          <span>Hacker News</span>
        </div>
        <button class="hn-refresh-btn ${isLoading ? 'loading' : ''}" onclick="refreshHNFeed()" ${isLoading ? 'disabled' : ''}>
          <span class="refresh-icon">↻</span> Refresh
        </button>
      </div>
      ${content}
    </div>
  `;
}

interface VSCodeAPI {
  postMessage(message: unknown): void;
}

/**
 * Setup HN feed event handlers
 * These are global window functions called from onclick attributes
 */
export function setupHNFeedHandlers(vscode: VSCodeAPI): void {
  (window as unknown as Record<string, unknown>).refreshHNFeed = function () {
    vscode.postMessage({ type: 'refreshHNFeed' });
  };

  (window as unknown as Record<string, unknown>).loadMoreHNFeed = function () {
    vscode.postMessage({ type: 'loadMoreHNFeed' });
  };

  (window as unknown as Record<string, unknown>).toggleFeed = function () {
    vscode.postMessage({ type: 'toggleFeed' });
  };

  (window as unknown as Record<string, unknown>).openHNStory = function (
    url: string,
    title: string
  ) {
    if (url) {
      vscode.postMessage({
        type: 'openHNStoryInPanel',
        url: url,
        title: title || 'HN Story',
      });
    }
  };

  (window as unknown as Record<string, unknown>).openHNStoryExternal =
    function (url: string) {
      if (url) {
        vscode.postMessage({
          type: 'openContentExternal',
          url: url,
        });
      }
    };

  (window as unknown as Record<string, unknown>).openHNComments = function (
    storyId: number
  ) {
    vscode.postMessage({ type: 'openHNComments', storyId: storyId });
  };
}
