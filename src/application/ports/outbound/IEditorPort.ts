export type EditorType = 'cursor' | 'vscode';

export interface IEditorPort {
    /**
     * Get the current editor type based on environment
     */
    getEditorType(): EditorType;

    /**
     * Open a folder in a new editor window
     */
    openFolder(folderPath: string): Promise<void>;
}
