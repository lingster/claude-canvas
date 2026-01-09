// Terminal Canvas - Type Definitions

export interface TerminalConfig {
  shell?: string;              // Shell to use (default: $SHELL or '/bin/bash')
  cwd?: string;                // Initial working directory (default: $HOME)
  env?: Record<string, string>; // Additional environment variables
  maxBufferLines?: number;     // Max output buffer lines (default: 10000)
  streamingEnabled?: boolean;  // Enable output streaming to controller (default: false)
  title?: string;              // Optional title for the canvas
  initialCommand?: string;     // Command to run when the shell starts
}

export interface OutputLine {
  content: string;             // Raw line content (may include ANSI codes)
  timestamp: number;           // Unix timestamp when received
  source: "stdout" | "stderr" | "system"; // Output source
}

export interface OutputBuffer {
  lines: OutputLine[];
  maxLines: number;
  totalLinesReceived: number;  // Total lines ever received (for offset tracking)
}

export interface ShellState {
  isRunning: boolean;          // Is a command currently executing?
  pid: number | null;          // Shell process PID
  lastExitCode: number | null; // Exit code of last command
  cwd: string;                 // Current working directory
  commandHistory: string[];    // Command history for up-arrow navigation
}

export interface ShellInfo {
  pid: number;
  shell: string;
  cwd: string;
}

// Result type for scenario completion
export interface TerminalResult {
  finalOutput: string;         // Last N lines of output
  exitCode: number | null;
  commandsExecuted: number;
}

// Default configuration values
export const DEFAULT_TERMINAL_CONFIG: Required<Omit<TerminalConfig, "env" | "title" | "initialCommand">> & Pick<TerminalConfig, "env" | "title" | "initialCommand"> = {
  shell: process.env.SHELL || "/bin/bash",
  cwd: process.env.HOME || "/",
  env: undefined,
  maxBufferLines: 10000,
  streamingEnabled: false,
  title: undefined,
  initialCommand: undefined,
};
