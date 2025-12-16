import { IOpenInEditorUseCase, OpenInEditorInput, OpenInEditorOutput } from '../ports/inbound/IOpenInEditorUseCase';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { IEditorPort } from '../ports/outbound/IEditorPort';

export class OpenInEditorUseCase implements IOpenInEditorUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly editorPort: IEditorPort
    ) {}

    async execute(input: OpenInEditorInput): Promise<OpenInEditorOutput> {
        // 1. Find thread state
        const threadState = await this.threadStateRepository.findById(input.threadId);
        if (!threadState) {
            return { success: false, error: 'Thread not found' };
        }

        // 2. Verify this is a worktree thread
        if (!threadState.worktreePath) {
            return { success: false, error: 'Thread does not have a worktree' };
        }

        // 3. Open in editor
        try {
            await this.editorPort.openFolder(threadState.worktreePath);
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to open editor'
            };
        }
    }
}
