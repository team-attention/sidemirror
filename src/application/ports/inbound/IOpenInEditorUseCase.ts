export interface OpenInEditorInput {
    threadId: string;
}

export interface OpenInEditorOutput {
    success: boolean;
    error?: string;
}

export interface IOpenInEditorUseCase {
    execute(input: OpenInEditorInput): Promise<OpenInEditorOutput>;
}
