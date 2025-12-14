import { AISession } from '../../../domain/entities/AISession';

export interface SubmitCommentsResult {
    submittedIds: string[];
    count: number;
}

export interface ISubmitCommentsUseCase {
    execute(session: AISession | undefined): Promise<SubmitCommentsResult | null>;
    executeWithRouting(focusedSession: AISession | undefined): Promise<SubmitCommentsResult | null>;
}
