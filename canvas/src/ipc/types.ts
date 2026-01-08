// IPC Message Types for Canvas Communication

// Messages sent from Controller (Claude) to Canvas
export type ControllerMessage =
  | { type: "close" }
  | { type: "update"; config: unknown }
  | { type: "ping" }
  | { type: "getSelection" }
  | { type: "getContent" }
  // Terminal-specific messages
  | { type: "executeCommand"; command: string }
  | { type: "getOutput"; lineCount?: number; fromEnd?: boolean }
  | { type: "interrupt" }
  | { type: "setStreaming"; enabled: boolean }
  | { type: "terminalInput"; data: string };

// Output line structure for terminal buffer responses
export interface OutputLineData {
  content: string;
  timestamp: number;
  source: "stdout" | "stderr" | "system";
}

// Messages sent from Canvas to Controller (Claude)
export type CanvasMessage =
  | { type: "ready"; scenario: string }
  | { type: "selected"; data: unknown }
  | { type: "cancelled"; reason?: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | { type: "selection"; data: { selectedText: string; startOffset: number; endOffset: number } | null }
  | { type: "content"; data: { content: string; cursorPosition: number } }
  // Terminal-specific messages
  | { type: "output"; chunk: string; source: "stdout" | "stderr" }
  | { type: "outputBuffer"; lines: OutputLineData[]; totalAvailable: number }
  | { type: "commandStarted"; command: string }
  | { type: "commandComplete"; exitCode: number; duration: number }
  | { type: "terminalReady"; scenario: string; shellInfo: { pid: number; shell: string; cwd: string } };

// Socket path convention
export function getSocketPath(id: string): string {
  return `/tmp/canvas-${id}.sock`;
}
