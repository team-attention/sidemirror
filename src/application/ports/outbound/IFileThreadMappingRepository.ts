import { FileThreadMapping } from '../../../domain/entities/FileThreadMapping';

export interface IFileThreadMappingRepository {
    save(mapping: FileThreadMapping): Promise<void>;
    findByFilePath(filePath: string): Promise<FileThreadMapping | null>;
    findByThreadId(threadId: string): Promise<FileThreadMapping[]>;
    findAll(): Promise<FileThreadMapping[]>;
    delete(filePath: string): Promise<boolean>;
    clear(): Promise<void>;
}
