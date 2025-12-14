export interface FileThreadMappingData {
    filePath: string;
    threadId: string;
    lastModifiedAt: number;
}

export class FileThreadMapping {
    readonly filePath: string;
    readonly threadId: string;
    readonly lastModifiedAt: number;

    constructor(data: FileThreadMappingData) {
        this.filePath = data.filePath;
        this.threadId = data.threadId;
        this.lastModifiedAt = data.lastModifiedAt;
    }

    static create(filePath: string, threadId: string): FileThreadMapping {
        return new FileThreadMapping({
            filePath,
            threadId,
            lastModifiedAt: Date.now(),
        });
    }

    static fromData(data: FileThreadMappingData): FileThreadMapping {
        return new FileThreadMapping(data);
    }

    toData(): FileThreadMappingData {
        return {
            filePath: this.filePath,
            threadId: this.threadId,
            lastModifiedAt: this.lastModifiedAt,
        };
    }
}
