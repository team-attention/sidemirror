import * as vscode from 'vscode';
import { ISymbolPort, ScopeInfo } from '../../../application/ports/outbound/ISymbolPort';

export class VscodeLspGateway implements ISymbolPort {
    async getEnclosingScope(filePath: string, line: number): Promise<ScopeInfo | null> {
        const uri = vscode.Uri.file(filePath);

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (!symbols || symbols.length === 0) {
                return null;
            }

            return this.findEnclosingSymbol(symbols, line);
        } catch (error) {
            console.error('[Sidecar] Failed to get document symbols:', error);
            return null;
        }
    }

    async getScopesForRange(filePath: string, startLine: number, endLine: number): Promise<ScopeInfo[]> {
        const uri = vscode.Uri.file(filePath);

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            return this.collectScopesInRange(symbols, startLine, endLine);
        } catch (error) {
            console.error('[Sidecar] Failed to get document symbols:', error);
            return [];
        }
    }

    async getAllFileSymbols(filePath: string): Promise<ScopeInfo[]> {
        const uri = vscode.Uri.file(filePath);

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                uri
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            return this.flattenSymbols(symbols);
        } catch (error) {
            console.error('[Sidecar] Failed to get document symbols:', error);
            return [];
        }
    }

    private flattenSymbols(
        symbols: vscode.DocumentSymbol[],
        containerName?: string
    ): ScopeInfo[] {
        const result: ScopeInfo[] = [];

        for (const symbol of symbols) {
            // Filter to relevant symbol kinds for scoped diff
            if (!this.isRelevantSymbolKind(symbol.kind)) {
                // Still process children for non-relevant symbols
                if (symbol.children && symbol.children.length > 0) {
                    result.push(...this.flattenSymbols(symbol.children, containerName));
                }
                continue;
            }

            // Skip anonymous/arrow functions and callbacks
            if (this.isAnonymousOrCallback(symbol)) {
                if (symbol.children && symbol.children.length > 0) {
                    result.push(...this.flattenSymbols(symbol.children, containerName));
                }
                continue;
            }

            const scopeInfo: ScopeInfo = {
                name: symbol.name,
                containerName,
                kind: this.symbolKindToString(symbol.kind),
                startLine: symbol.range.start.line + 1, // 1-indexed
                endLine: symbol.range.end.line + 1,
            };

            result.push(scopeInfo);

            if (symbol.children && symbol.children.length > 0) {
                result.push(...this.flattenSymbols(symbol.children, symbol.name));
            }
        }

        return result;
    }

    private isRelevantSymbolKind(kind: vscode.SymbolKind): boolean {
        const relevant = [
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Constructor,
            vscode.SymbolKind.Interface,
            vscode.SymbolKind.Enum,
            vscode.SymbolKind.Module,
            vscode.SymbolKind.Namespace,
        ];
        return relevant.includes(kind);
    }

    private isAnonymousOrCallback(symbol: vscode.DocumentSymbol): boolean {
        // Skip anonymous functions, arrow functions, callbacks
        const name = symbol.name.toLowerCase();

        // Anonymous or unnamed
        if (!name || name === '<function>' || name === '<anonymous>') {
            return true;
        }

        // Arrow function callbacks (typically short names or contain arrow indicators)
        if (symbol.kind === vscode.SymbolKind.Function) {
            // Skip if it looks like a callback (e.g., single letter params, arrow syntax indicators)
            // These are typically nested inside methods and not top-level named functions
            if (name.length <= 2 || name.startsWith('(')) {
                return true;
            }
        }

        return false;
    }

    private findEnclosingSymbol(
        symbols: vscode.DocumentSymbol[],
        line: number,
        containerName?: string
    ): ScopeInfo | null {
        for (const symbol of symbols) {
            const startLine = symbol.range.start.line + 1;
            const endLine = symbol.range.end.line + 1;

            if (line >= startLine && line <= endLine) {
                if (symbol.children && symbol.children.length > 0) {
                    const childScope = this.findEnclosingSymbol(
                        symbol.children,
                        line,
                        symbol.name
                    );
                    if (childScope) {
                        return childScope;
                    }
                }

                return {
                    name: symbol.name,
                    containerName,
                    kind: this.symbolKindToString(symbol.kind),
                    startLine,
                    endLine
                };
            }
        }
        return null;
    }

    private collectScopesInRange(
        symbols: vscode.DocumentSymbol[],
        startLine: number,
        endLine: number,
        containerName?: string
    ): ScopeInfo[] {
        const result: ScopeInfo[] = [];

        for (const symbol of symbols) {
            const symStart = symbol.range.start.line + 1;
            const symEnd = symbol.range.end.line + 1;

            if (symStart <= endLine && symEnd >= startLine) {
                result.push({
                    name: symbol.name,
                    containerName,
                    kind: this.symbolKindToString(symbol.kind),
                    startLine: symStart,
                    endLine: symEnd
                });

                if (symbol.children && symbol.children.length > 0) {
                    result.push(
                        ...this.collectScopesInRange(
                            symbol.children,
                            startLine,
                            endLine,
                            symbol.name
                        )
                    );
                }
            }
        }

        return result;
    }

    private symbolKindToString(kind: vscode.SymbolKind): string {
        const kindMap: Record<vscode.SymbolKind, string> = {
            [vscode.SymbolKind.File]: 'file',
            [vscode.SymbolKind.Module]: 'module',
            [vscode.SymbolKind.Namespace]: 'namespace',
            [vscode.SymbolKind.Package]: 'package',
            [vscode.SymbolKind.Class]: 'class',
            [vscode.SymbolKind.Method]: 'method',
            [vscode.SymbolKind.Property]: 'property',
            [vscode.SymbolKind.Field]: 'field',
            [vscode.SymbolKind.Constructor]: 'constructor',
            [vscode.SymbolKind.Enum]: 'enum',
            [vscode.SymbolKind.Interface]: 'interface',
            [vscode.SymbolKind.Function]: 'function',
            [vscode.SymbolKind.Variable]: 'variable',
            [vscode.SymbolKind.Constant]: 'constant',
            [vscode.SymbolKind.String]: 'string',
            [vscode.SymbolKind.Number]: 'number',
            [vscode.SymbolKind.Boolean]: 'boolean',
            [vscode.SymbolKind.Array]: 'array',
            [vscode.SymbolKind.Object]: 'object',
            [vscode.SymbolKind.Key]: 'key',
            [vscode.SymbolKind.Null]: 'null',
            [vscode.SymbolKind.EnumMember]: 'enum-member',
            [vscode.SymbolKind.Struct]: 'struct',
            [vscode.SymbolKind.Event]: 'event',
            [vscode.SymbolKind.Operator]: 'operator',
            [vscode.SymbolKind.TypeParameter]: 'type-parameter',
        };
        return kindMap[kind] || 'unknown';
    }
}
