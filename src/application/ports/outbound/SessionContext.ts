import { AISession, AgentMetadata } from '../../../domain/entities/AISession';
import { ThreadState } from '../../../domain/entities/ThreadState';
import { ISnapshotRepository } from './ISnapshotRepository';
import { IPanelStateManager } from '../../services/IPanelStateManager';
import { IGenerateDiffUseCase } from '../inbound/IGenerateDiffUseCase';
import { IGenerateScopedDiffUseCase } from '../inbound/IGenerateScopedDiffUseCase';
import { IAddCommentUseCase } from '../inbound/IAddCommentUseCase';
import { IEditCommentUseCase } from '../inbound/IEditCommentUseCase';
import { IDeleteCommentUseCase } from '../inbound/IDeleteCommentUseCase';
import { IFetchHNStoriesUseCase } from '../inbound/IFetchHNStoriesUseCase';
import { ICaptureSnapshotsUseCase } from '../inbound/ICaptureSnapshotsUseCase';

/**
 * 터미널 하나에 바인딩된 독립 세션 컨텍스트
 * 패널, 상태, 스냅샷이 모두 이 세션에 격리됨
 */
export interface SessionContext {
    /** 터미널 식별자 */
    terminalId: string;

    /** AI 세션 정보 */
    session: AISession;

    /** 터미널의 작업 디렉토리 (worktree 지원용) */
    workspaceRoot: string;

    /** 이 세션의 스냅샷 저장소 */
    snapshotRepository: ISnapshotRepository;

    /** 이 세션의 상태 관리자 */
    stateManager: IPanelStateManager;

    /** 이 세션의 Diff UseCase */
    generateDiffUseCase: IGenerateDiffUseCase;

    /** 이 세션의 Comment UseCase */
    addCommentUseCase: IAddCommentUseCase;

    /** 이 세션의 Edit Comment UseCase */
    editCommentUseCase: IEditCommentUseCase;

    /** 이 세션의 Delete Comment UseCase */
    deleteCommentUseCase: IDeleteCommentUseCase;

    /** 이 세션의 Scoped Diff UseCase */
    generateScopedDiffUseCase: IGenerateScopedDiffUseCase;

    /** HN Stories UseCase (공유) */
    fetchHNStoriesUseCase?: IFetchHNStoriesUseCase;

    /** 이 세션의 Snapshot UseCase */
    captureSnapshotsUseCase: ICaptureSnapshotsUseCase;

    /** 패널 dispose 콜백 (AIDetectionController에서 설정) */
    disposePanel: () => void;

    /** 코멘트 제출 콜백 (싱글 패널 아키텍처용) */
    submitComments: () => Promise<void>;

    /** 에이전트 메타데이터 (멀티 에이전트 지원용) */
    agentMetadata?: AgentMetadata;

    /** 스레드 상태 (멀티 스레드 지원용) */
    threadState?: ThreadState;
}
