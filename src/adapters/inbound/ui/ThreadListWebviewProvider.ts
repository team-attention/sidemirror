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
    workingDir: string;
    hasWorktree: boolean;
    threadId: string;
}

export interface CreateThreadOptions {
    name: string;
    isolationMode: IsolationMode;
    branchName?: string;
    worktreePath?: string;
}

export class ThreadListWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codeSquadThreadList';

    private view?: vscode.WebviewView;
    private selectedId: string = '';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly getSessions: () => Map<string, SessionContext>,
        private readonly onSelectThread: (id: string) => void,
        private readonly onCreateThread: (options: CreateThreadOptions) => void,
        private readonly onOpenNewTerminal: (id: string) => void,
        private readonly onAttachToWorktree: () => void,
        private readonly onDeleteThread?: (threadId: string) => void,
        private readonly onOpenInEditor?: (threadId: string) => void
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
                case 'openNewTerminal':
                    this.onOpenNewTerminal(message.id);
                    break;
                case 'attachToWorktree':
                    this.onAttachToWorktree();
                    break;
                case 'deleteThread':
                    if (this.onDeleteThread) {
                        this.onDeleteThread(message.threadId);
                    }
                    break;
                case 'openInEditor':
                    if (this.onOpenInEditor) {
                        this.onOpenInEditor(message.threadId);
                    }
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

            // Working directory priority: worktreePath > workspaceRoot
            const workingDir = threadState?.worktreePath || ctx.workspaceRoot;

            threads.push({
                id: terminalId,
                name,
                status: metadata?.status ?? 'inactive',
                fileCount,
                isSelected: this.selectedId === terminalId,
                workingDir,
                hasWorktree: !!threadState?.worktreePath,
                threadId: threadState?.threadId ?? ''
            });
        }

        return threads;
    }

    private getHtmlContent(): string {
        const nonce = this.getNonce();
        const cspSource = this.view!.webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${cspSource};">
    <style nonce="${nonce}">
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
        .submit-button.secondary-button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);margin-top:4px}
        .submit-button.secondary-button:hover{background:var(--vscode-button-secondaryHoverBackground)}
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
        .thread-actions{display:flex;gap:2px;opacity:0;transition:opacity 0.15s;flex-shrink:0}
        .thread-item:hover .thread-actions{opacity:1}
        .thread-action-btn{display:flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:11px;color:var(--vscode-descriptionForeground);background:transparent;border:none;cursor:pointer;border-radius:3px}
        .thread-action-btn:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}
        .thread-action-btn.delete:hover{color:var(--vscode-errorForeground)}
        .empty-msg{padding:8px 12px;color:var(--vscode-descriptionForeground);font-style:italic}
        /* Drag handle - hover 시 표시 */
        .drag-handle{display:flex;align-items:center;justify-content:center;width:16px;color:var(--vscode-descriptionForeground);opacity:0;cursor:grab;flex-shrink:0;font-size:10px;letter-spacing:-2px}
        .thread-item:hover .drag-handle{opacity:1}
        .thread-item.dragging .drag-handle{cursor:grabbing}
        /* 드래그 중인 아이템 */
        .thread-item.dragging{opacity:0.5}
        /* 드롭 인디케이터 */
        .thread-item.drag-over-top{box-shadow:inset 0 2px 0 var(--vscode-focusBorder)}
        .thread-item.drag-over-bottom{box-shadow:inset 0 -2px 0 var(--vscode-focusBorder)}
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
            <button class="submit-button secondary-button" id="attachBtn">Attach to Worktree</button>
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
<script nonce="${nonce}">
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

// 스레드 순서 관리 (thread id 배열)
let orderedThreadIds = [];

// 드래그 상태 변수
let draggedItem = null;
let draggedIndex = -1;
let lastThreads = [];

// threads를 orderedThreadIds 순서로 정렬, 새 스레드는 상단에 추가
function sortThreads(threads) {
    const result = [];
    const threadMap = new Map(threads.map(t => [t.id, t]));

    // 기존 순서의 스레드들
    for (const id of orderedThreadIds) {
        if (threadMap.has(id)) {
            result.push(threadMap.get(id));
            threadMap.delete(id);
        }
    }

    // 새 스레드들 (상단에 추가)
    const newThreads = Array.from(threadMap.values());
    result.unshift(...newThreads);

    // 순서 업데이트
    orderedThreadIds = result.map(t => t.id);

    return result;
}

// 순서 재배치
function reorderThreads(fromIndex, toIndex) {
    const [moved] = orderedThreadIds.splice(fromIndex, 1);
    orderedThreadIds.splice(toIndex, 0, moved);
}

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

// Attach to worktree
$('attachBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'attachToWorktree' });
});

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

// 드래그 클린업
function cleanup() {
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
    }
    threadList.querySelectorAll('.thread-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    draggedItem = null;
    draggedIndex = -1;
}

// Render threads
function render(threads) {
    lastThreads = threads;

    if (!threads.length) {
        threadList.innerHTML = '<div class="empty-msg">No threads yet</div>';
        orderedThreadIds = [];
        return;
    }

    // 순서 적용
    const sorted = sortThreads(threads);

    threadList.innerHTML = sorted.map(t =>
        '<div class="thread-item ' + t.status + (t.isSelected ? ' selected' : '') + '" data-id="' + t.id + '" data-thread-id="' + t.threadId + '" data-has-worktree="' + t.hasWorktree + '" draggable="true">' +
        '<span class="drag-handle">\u22EE\u22EE</span>' +
        '<span class="thread-status ' + t.status + '" title="' + getStatusTitle(t.status) + '">' + getStatusIcon(t.status) + '</span>' +
        '<span class="thread-name">' + esc(t.name) + '</span>' +
        '<div class="thread-actions">' +
        '<button class="thread-action-btn terminal" title="Open Terminal"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3l4 4-4 4v-1l3-3-3-3V3zm5 7h5v1H8v-1z"/></svg></button>' +
        (t.hasWorktree ? '<button class="thread-action-btn editor" title="Open in Editor"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1H10v1H2v12h12V6h1v8.5l-.5.5h-13l-.5-.5v-13l.5-.5z"/><path d="M15 1.5V5h-1V2.707L8.354 8.354l-.708-.708L13.293 2H11V1h3.5l.5.5z"/></svg></button>' : '') +
        '<button class="thread-action-btn delete" title="Cleanup">\uD83D\uDDD1\uFE0F</button>' +
        '</div>' +
        '</div>'
    ).join('');

    threadList.querySelectorAll('.thread-item').forEach((el, index) => {
        const threadId = el.dataset.threadId;
        el.addEventListener('click', () => vscode.postMessage({ type: 'selectThread', id: el.dataset.id }));
        el.querySelector('.terminal').addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'openNewTerminal', id: el.dataset.id });
        });
        const editorBtn = el.querySelector('.editor');
        if (editorBtn) {
            editorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'openInEditor', threadId });
            });
        }
        el.querySelector('.delete').addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteThread', threadId });
        });

        // dragstart
        el.addEventListener('dragstart', (e) => {
            draggedItem = el;
            draggedIndex = index;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.dataset.id);
        });

        // dragover
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === el) return;

            const rect = el.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const isAbove = e.clientY < midY;

            // 기존 인디케이터 제거
            const currentIndicator = threadList.querySelector('.drag-over-top, .drag-over-bottom');
            if (currentIndicator) {
                currentIndicator.classList.remove('drag-over-top', 'drag-over-bottom');
            }

            // 새 인디케이터 표시
            el.classList.add(isAbove ? 'drag-over-top' : 'drag-over-bottom');
        });

        // dragleave
        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // drop
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === el) return;

            const rect = el.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const isAbove = e.clientY < midY;

            let targetIndex = index;
            if (!isAbove && targetIndex < orderedThreadIds.length - 1) {
                targetIndex++;
            }
            if (draggedIndex < targetIndex) {
                targetIndex--;
            }

            reorderThreads(draggedIndex, targetIndex);

            // 클린업 및 리렌더
            cleanup();
            render(lastThreads);
        });

        // dragend
        el.addEventListener('dragend', () => {
            cleanup();
        });
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

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
