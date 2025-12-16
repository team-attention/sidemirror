import { IRenameThreadUseCase, RenameThreadInput, RenameThreadOutput } from '../ports/inbound/IRenameThreadUseCase';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { ITerminalPort } from '../ports/outbound/ITerminalPort';
import { IDetectThreadStatusUseCase } from '../ports/inbound/IDetectThreadStatusUseCase';

export class RenameThreadUseCase implements IRenameThreadUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly detectStatusUseCase: IDetectThreadStatusUseCase
    ) {}

    async execute(input: RenameThreadInput): Promise<RenameThreadOutput> {
        const { threadId, newName } = input;

        // 1. Find thread state
        const threadState = await this.threadStateRepository.findById(threadId);
        if (!threadState) {
            return {
                success: false,
                threadState: null,
                previousName: null
            };
        }

        const previousName = threadState.name;

        // 2. Create new thread state with updated name (immutable)
        // This will throw if newName is invalid (empty or >50 chars)
        const updatedState = threadState.withName(newName);

        // 3. Update terminal display name
        if (threadState.terminalId) {
            this.terminalPort.updateTerminalName(threadState.terminalId, newName);
        }

        // 4. Update status detection thread name
        this.detectStatusUseCase.setThreadName(threadState.terminalId, newName);

        // 5. Save updated thread state
        await this.threadStateRepository.save(updatedState);

        return {
            success: true,
            threadState: updatedState,
            previousName
        };
    }
}
