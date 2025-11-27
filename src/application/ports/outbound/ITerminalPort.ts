export interface ITerminalPort {
    sendText(terminalId: string, text: string): void;
    showTerminal(terminalId: string): void;
}
