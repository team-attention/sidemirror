/**
 * Webview Entry Point
 *
 * This file is the entry point for the bundled webview script.
 * It gets compiled separately by esbuild and the result is embedded in the webview.
 */

import {
    createHighlighterCore,
    type HighlighterCore,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Import bundled languages (core set for smaller bundle)
import langTypescript from 'shiki/dist/langs/typescript.mjs';
import langJavascript from 'shiki/dist/langs/javascript.mjs';
import langPython from 'shiki/dist/langs/python.mjs';
import langJson from 'shiki/dist/langs/json.mjs';
import langYaml from 'shiki/dist/langs/yaml.mjs';
import langHtml from 'shiki/dist/langs/html.mjs';
import langCss from 'shiki/dist/langs/css.mjs';
import langMarkdown from 'shiki/dist/langs/markdown.mjs';
import langShellscript from 'shiki/dist/langs/shellscript.mjs';

// Theme
import themeGithubDark from 'shiki/dist/themes/github-dark.mjs';

// ===== Syntax Highlighter =====

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;

const SUPPORTED_LANGUAGES = [
    langTypescript,
    langJavascript,
    langPython,
    langJson,
    langYaml,
    langHtml,
    langCss,
    langMarkdown,
    langShellscript,
];

async function initHighlighter(): Promise<HighlighterCore> {
    if (highlighter) {
        return highlighter;
    }

    if (!highlighterPromise) {
        highlighterPromise = createHighlighterCore({
            themes: [themeGithubDark],
            langs: SUPPORTED_LANGUAGES,
            engine: createJavaScriptRegexEngine(),
        });
    }

    highlighter = await highlighterPromise;
    return highlighter;
}

function escapeHtmlForHighlight(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Highlight multiple lines efficiently
 */
async function highlightLines(
    lines: string[],
    language: string
): Promise<string[]> {
    const hl = await initHighlighter();

    const loadedLangs = hl.getLoadedLanguages();
    if (!loadedLangs.includes(language)) {
        return lines.map(escapeHtmlForHighlight);
    }

    const code = lines.join('\n');
    try {
        const html = hl.codeToHtml(code, {
            lang: language,
            theme: 'github-dark',
        });

        const match = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
        if (match) {
            return match[1].split('\n');
        }
    } catch {
        // Fall through to plain text
    }

    return lines.map(escapeHtmlForHighlight);
}

/**
 * Highlight code block for markdown
 */
async function highlightCodeBlock(
    code: string,
    language: string
): Promise<string> {
    const langMap: Record<string, string> = {
        js: 'javascript',
        ts: 'typescript',
        py: 'python',
        sh: 'shellscript',
        bash: 'shellscript',
        yml: 'yaml',
    };

    const normalizedLang = langMap[language] || language || 'plaintext';
    const hl = await initHighlighter();

    const loadedLangs = hl.getLoadedLanguages();
    if (!loadedLangs.includes(normalizedLang)) {
        return escapeHtmlForHighlight(code);
    }

    try {
        const html = hl.codeToHtml(code, {
            lang: normalizedLang,
            theme: 'github-dark',
        });

        const match = html.match(/<code[^>]*>([\s\S]*)<\/code>/);
        return match ? match[1] : escapeHtmlForHighlight(code);
    } catch {
        return escapeHtmlForHighlight(code);
    }
}

// ===== Language Detection =====

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript', // Falls back to TypeScript
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript', // Falls back to JavaScript
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',
    '.json': 'json',
    '.jsonc': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
};

function getLanguageFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    const filename = parts[parts.length - 1].toLowerCase();

    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) {
        return 'plaintext';
    }

    const extension = filename.slice(lastDot).toLowerCase();
    return EXTENSION_TO_LANGUAGE[extension] || 'plaintext';
}

// ===== Expose to window =====
declare global {
    interface Window {
        SidecarHighlighter: {
            highlightLines: typeof highlightLines;
            highlightCodeBlock: typeof highlightCodeBlock;
            getLanguageFromPath: typeof getLanguageFromPath;
            preload: () => void;
        };
    }
}

window.SidecarHighlighter = {
    highlightLines,
    highlightCodeBlock,
    getLanguageFromPath,
    preload: () => {
        initHighlighter().catch(console.error);
    },
};

// Preload highlighter
window.SidecarHighlighter.preload();
