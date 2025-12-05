import { webviewStyles } from './styles';
import { webviewHtml } from './html';
import { webviewScript } from './script';

export function getWebviewContent(highlighterScriptUri?: string): string {
    // If highlighter script URI is provided, load it before the main script
    const highlighterScript = highlighterScriptUri
        ? `<script src="${highlighterScriptUri}"></script>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sidecar</title>
    <style>${webviewStyles}</style>
</head>
${webviewHtml}
${highlighterScript}
<script>${webviewScript}</script>
</body>
</html>`;
}
