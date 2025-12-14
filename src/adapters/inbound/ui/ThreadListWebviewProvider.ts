import * as vscode from 'vscode';
import * as path from 'path';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { AgentStatus } from '../../../domain/entities/AISession';
import { IsolationMode } from '../../../application/ports/inbound/ICreateThreadUseCase';

interface ThreadInfo {
    id: string;
    name: string;
    status: AgentStatus;
    fileCount: number;
    isSelected: boolean;
}

export interface CreateThreadOptions {
    name: string;
    isolationMode: IsolationMode;
    branchName?: string;
    worktreePath?: string;
}

export class ThreadListWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'sidecarThreadList';

    private view?: vscode.WebviewView;
    private selectedId: string = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly getSessions: () => Map<string, SessionContext>,
        private readonly onSelectThread: (id: string) => void,
        private readonly onCreateThread: (options: CreateThreadOptions) => void
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'webviewReady':
                    // Webview is ready to receive messages, send initial data
                    this.sendWorkspaceInfo();
                    this.refresh();
                    break;
                case 'selectThread':
                    this.onSelectThread(message.id);
                    break;
                case 'createThread':
                    this.onCreateThread({
                        name: message.name,
                        isolationMode: message.isolationMode,
                        branchName: message.branchName,
                        worktreePath: message.worktreePath,
                    });
                    break;
            }
        });
    }

    setSelectedId(id: string): void {
        this.selectedId = id;
        this.refresh();
    }

    refresh(): void {
        if (!this.view) return;

        const threads = this.buildThreadList();
        this.view.webview.postMessage({
            type: 'updateThreads',
            threads
        });
    }

    private sendWorkspaceInfo(): void {
        if (!this.view) return;

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const workspaceName = workspaceRoot ? path.basename(workspaceRoot) : '';

        this.view.webview.postMessage({
            type: 'workspaceInfo',
            workspaceName
        });
    }

    private buildThreadList(): ThreadInfo[] {
        const sessions = this.getSessions();
        const threads: ThreadInfo[] = [];

        // Add individual threads
        for (const [terminalId, ctx] of sessions) {
            const session = ctx.session;
            const metadata = session.agentMetadata;
            const threadState = ctx.threadState;
            const fileCount = ctx.stateManager.getState().sessionFiles.length;

            // Name priority: threadState.name > agentMetadata.name > session.displayName
            const name = threadState?.name ?? metadata?.name ?? session.displayName;

            threads.push({
                id: terminalId,
                name,
                status: metadata?.status ?? 'inactive',
                fileCount,
                isSelected: this.selectedId === terminalId
            });
        }

        return threads;
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        html,body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow-x:hidden;width:100%;padding:0!important;margin:0!important}
        .section{border-bottom:1px solid var(--vscode-panel-border)}
        .section-header{display:flex;align-items:center;padding:6px 0;cursor:pointer;user-select:none;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--vscode-sideBarSectionHeader-foreground)}
        .section-header:hover{background:var(--vscode-list-hoverBackground)}
        .section-header .codicon{font-size:16px;margin-right:2px}
        .section-content{padding:8px 12px 12px 12px}
        .section-content.collapsed{display:none}
        .form-group{margin-bottom:10px}
        .form-group.hidden{display:none}
        .form-row{display:flex;gap:8px;margin-bottom:10px}
        .form-row .form-group{margin-bottom:0;flex:1}
        .form-row .form-group.isolation{flex:0 0 90px}
        .form-label{display:block;font-size:11px;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:4px}
        .form-input,.form-select{width:100%;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);color:var(--vscode-input-foreground);padding:4px 6px;font-size:13px}
        .form-input:focus,.form-select:focus{outline:none;border-color:var(--vscode-focusBorder)}
        .form-input::placeholder{color:var(--vscode-input-placeholderForeground)}
        .submit-button{width:100%;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:6px 12px;font-size:13px;cursor:pointer;margin-top:8px}
        .submit-button:hover{background:var(--vscode-button-hoverBackground)}
        .thread-item{display:flex;align-items:center;gap:10px;padding:12px 12px;cursor:pointer;min-height:44px}
        .thread-item:hover{background:var(--vscode-list-hoverBackground)}
        .thread-item.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
        .thread-item.waiting{animation:bg-blink 1s ease-in-out infinite}
        @keyframes bg-blink{0%,100%{background:rgba(204,167,0,0.15)}50%{background:transparent}}
        .thread-icon{width:16px;text-align:center;flex-shrink:0}
        .thread-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .thread-status{display:flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:10px;flex-shrink:0}
        .thread-status.inactive{color:var(--vscode-disabledForeground)}
        .thread-status.idle{color:var(--vscode-charts-blue,#3794ff)}
        .thread-status.working{color:var(--vscode-charts-green,#89d185);animation:pulse 1.5s ease-in-out infinite;text-shadow:0 0 8px var(--vscode-charts-green,#89d185)}
        .thread-status.waiting{color:var(--vscode-charts-yellow,#cca700);animation:blink 1s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.2)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}
        .thread-file-count{font-size:11px;color:var(--vscode-descriptionForeground);flex-shrink:0}
        .empty-msg{padding:8px 12px;color:var(--vscode-descriptionForeground);font-style:italic}
    </style>
</head>
<body>
    <div class="section">
        <div class="section-header" data-section="new">
            <span class="codicon">▾</span> New Thread
        </div>
        <div class="section-content" id="newContent">
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Thread Name</label>
                    <input type="text" class="form-input" id="threadName" placeholder="e.g., feat/add-login">
                </div>
                <div class="form-group isolation">
                    <label class="form-label">Isolation</label>
                    <select class="form-select" id="isolationMode">
                        <option value="none">Local</option>
                        <option value="worktree">Worktree</option>
                    </select>
                </div>
            </div>
            <div class="form-group hidden" id="branchGroup">
                <label class="form-label">Branch Name</label>
                <input type="text" class="form-input" id="branchName" placeholder="branch-name">
            </div>
            <div class="form-group hidden" id="pathGroup">
                <label class="form-label">Worktree Path</label>
                <input type="text" class="form-input" id="worktreePath" placeholder="../project.worktree/branch-name">
            </div>
            <button class="submit-button" id="startBtn">Start Thread</button>
        </div>
    </div>
    <div class="section">
        <div class="section-header" data-section="threads">
            <span class="codicon">▾</span> Agent Threads
        </div>
        <div class="section-content" id="threadsContent" style="padding:0">
            <div id="threadList"><div class="empty-msg">No threads yet</div></div>
        </div>
    </div>
<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const threadName = $('threadName');
const branchName = $('branchName');
const branchGroup = $('branchGroup');
const worktreePath = $('worktreePath');
const pathGroup = $('pathGroup');
const isolationMode = $('isolationMode');
const threadList = $('threadList');

let workspaceName = '';

function updateWorktreePath() {
    if (!worktreePath.dataset.edited && workspaceName) {
        const branch = branchName.value || threadName.value;
        worktreePath.value = branch ? '../' + workspaceName + '.worktree/' + branch : '';
    }
}

// Sync branch name with thread name
threadName.addEventListener('input', () => {
    if (!branchName.dataset.edited) {
        branchName.value = threadName.value;
    }
    updateWorktreePath();
});
branchName.addEventListener('input', () => {
    branchName.dataset.edited = branchName.value !== threadName.value ? '1' : '';
    updateWorktreePath();
});
worktreePath.addEventListener('input', () => {
    const defaultPath = '../' + workspaceName + '.worktree/' + (branchName.value || threadName.value);
    worktreePath.dataset.edited = worktreePath.value !== defaultPath ? '1' : '';
});

// Toggle branch name and path inputs based on isolation mode
isolationMode.addEventListener('change', () => {
    const show = isolationMode.value !== 'none';
    branchGroup.classList.toggle('hidden', !show);
    pathGroup.classList.toggle('hidden', !show);
    if (show) {
        if (!branchName.value) branchName.value = threadName.value;
        updateWorktreePath();
    }
});

// Toggle sections
document.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => {
        const content = h.nextElementSibling;
        const icon = h.querySelector('.codicon');
        const collapsed = content.classList.toggle('collapsed');
        icon.textContent = collapsed ? '▸' : '▾';
    });
});

// Create thread
$('startBtn').addEventListener('click', () => {
    const name = threadName.value.trim();
    if (!name) { threadName.focus(); return; }

    const mode = isolationMode.value;
    const path = worktreePath.value.trim();

    vscode.postMessage({
        type: 'createThread',
        name,
        isolationMode: mode,
        branchName: mode !== 'none' ? (branchName.value.trim() || name) : undefined,
        worktreePath: mode !== 'none' && path ? path : undefined
    });

    threadName.value = '';
    branchName.value = '';
    branchName.dataset.edited = '';
    worktreePath.value = '';
    worktreePath.dataset.edited = '';
    isolationMode.value = 'none';
    branchGroup.classList.add('hidden');
    pathGroup.classList.add('hidden');
});

threadName.addEventListener('keydown', e => { if (e.key === 'Enter') $('startBtn').click(); });

// Status icon and title mappings
function getStatusIcon(status) {
    switch (status) {
        case 'inactive': return '\u25CB';  // ○ Empty circle
        case 'idle': return '\u25CF';      // ● Filled circle
        case 'working': return '\u25CF';   // ● Filled circle (animated)
        case 'waiting': return '\u25CF';   // ● Filled circle
        default: return '\u25CB';
    }
}

function getStatusTitle(status) {
    switch (status) {
        case 'inactive': return 'No AI agent';
        case 'idle': return 'AI idle - ready for input';
        case 'working': return 'AI working...';
        case 'waiting': return 'AI waiting for answer';
        default: return '';
    }
}

// Render threads
function render(threads) {
    if (!threads.length) {
        threadList.innerHTML = '<div class="empty-msg">No threads yet</div>';
        return;
    }
    threadList.innerHTML = threads.map(t =>
        '<div class="thread-item ' + t.status + (t.isSelected ? ' selected' : '') + '" data-id="' + t.id + '">' +
        '<span class="thread-status ' + t.status + '" title="' + getStatusTitle(t.status) + '">' + getStatusIcon(t.status) + '</span>' +
        '<span class="thread-name">' + esc(t.name) + '</span>' +
        '</div>'
    ).join('');

    threadList.querySelectorAll('.thread-item').forEach(el => {
        el.addEventListener('click', () => vscode.postMessage({ type: 'selectThread', id: el.dataset.id }));
    });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

window.addEventListener('message', e => {
    if (e.data.type === 'updateThreads') render(e.data.threads);
    if (e.data.type === 'workspaceInfo') workspaceName = e.data.workspaceName || '';
});

// Notify extension that webview is ready to receive messages
vscode.postMessage({ type: 'webviewReady' });
</script>
</body>
</html>`;
    }
}
