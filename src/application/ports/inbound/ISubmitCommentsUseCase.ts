import { AISession } from '../../../domain/entities/AISession';

export interface ISubmitCommentsUseCase {
    execute(session: AISession | undefined): Promise<void>;
}
