import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IEditorPort, EditorType } from '../../../application/ports/outbound/IEditorPort';

const execAsync = promisify(exec);

export class VscodeEditorGateway implements IEditorPort {
    getEditorType(): EditorType {
        const appName = vscode.env.appName.toLowerCase();
        return appName.includes('cursor') ? 'cursor' : 'vscode';
    }

    async openFolder(folderPath: string): Promise<void> {
        const command = this.getEditorType() === 'cursor' ? 'cursor' : 'code';
        await execAsync(`${command} "${folderPath}"`);
    }
}
