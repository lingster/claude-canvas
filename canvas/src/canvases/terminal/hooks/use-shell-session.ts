import { useEffect, useRef, useCallback, useState } from "react";
import { spawn, type Subprocess, type FileSink } from "bun";
import type { ShellState, TerminalConfig, DEFAULT_TERMINAL_CONFIG } from "../types";

export interface UseShellSessionOptions {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  onOutput: (chunk: string, source: "stdout" | "stderr") => void;
  onExit: (code: number) => void;
  onError: (error: Error) => void;
  onStateChange?: (state: Partial<ShellState>) => void;
}

export interface ShellSessionHandle {
  execute: (command: string) => void;
  write: (data: string) => void;
  interrupt: () => void;
  getPid: () => number | null;
  getCwd: () => string;
  isRunning: () => boolean;
  getLastExitCode: () => number | null;
  close: () => void;
  getShell: () => string;
}

// Marker to detect command completion
const COMMAND_MARKER = "__CANVAS_CMD_DONE__";
const EXIT_CODE_MARKER = "__CANVAS_EXIT_CODE__";

export function useShellSession(
  options: UseShellSessionOptions
): ShellSessionHandle {
  const {
    shell = process.env.SHELL || "/bin/bash",
    cwd = process.env.HOME || "/",
    env,
    onOutput,
    onExit,
    onError,
    onStateChange,
  } = options;

  const processRef = useRef<Subprocess | null>(null);
  const writerRef = useRef<FileSink | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [currentCwd, setCurrentCwd] = useState(cwd);
  const commandStartTimeRef = useRef<number | null>(null);
  const pendingOutputRef = useRef<string>("");

  // Start shell process on mount
  useEffect(() => {
    const startShell = async () => {
      try {
        // Spawn shell without -i flag (which conflicts with Ink's terminal handling)
        // We'll source rc files explicitly in the initialization command
        const proc = spawn({
          cmd: [shell],
          cwd,
          env: {
            ...process.env,
            ...env,
            TERM: "xterm-256color",
            // Use simple prompts to avoid cluttering output with complex escape sequences
            PS1: "$ ",
            PS2: "> ",
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        processRef.current = proc;

        // Get stdin FileSink for writing
        if (proc.stdin) {
          writerRef.current = proc.stdin;
        }

        // Read stdout
        if (proc.stdout) {
          const reader = proc.stdout.getReader();
          const decoder = new TextDecoder();

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                processOutput(text, "stdout");
              }
            } catch (err) {
              // Stream closed
            }
          })();
        }

        // Read stderr
        if (proc.stderr) {
          const reader = proc.stderr.getReader();
          const decoder = new TextDecoder();

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                processOutput(text, "stderr");
              }
            } catch (err) {
              // Stream closed
            }
          })();
        }

        // Handle process exit
        proc.exited.then((exitCode) => {
          processRef.current = null;
          writerRef.current = null;
          onExit(exitCode);
        });

        // Source user's rc files to get aliases, functions, and environment variables
        // This is done explicitly rather than using -i flag which conflicts with Ink
        if (writerRef.current) {
          const encoder = new TextEncoder();
          const home = process.env.HOME || "";

          // Determine which rc file to source based on shell type
          let rcFile = "";
          if (shell.includes("zsh")) {
            rcFile = `${home}/.zshrc`;
          } else if (shell.includes("bash")) {
            rcFile = `${home}/.bashrc`;
          }

          // Source the rc file if it exists, silently (suppress output)
          if (rcFile) {
            writerRef.current.write(
              encoder.encode(`[ -f "${rcFile}" ] && source "${rcFile}" >/dev/null 2>&1; :\n`)
            );
          } else {
            // Just a no-op to prime the shell
            writerRef.current.write(encoder.encode(":\n"));
          }
        }

        onStateChange?.({ pid: proc.pid, cwd });
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    startShell();

    return () => {
      // Cleanup on unmount
      if (processRef.current) {
        processRef.current.kill();
        processRef.current = null;
      }
    };
  }, []);

  // Process output and detect command completion
  const processOutput = useCallback(
    (text: string, source: "stdout" | "stderr") => {
      pendingOutputRef.current += text;

      // Check for our exit code marker
      const exitCodeMatch = pendingOutputRef.current.match(
        new RegExp(`${EXIT_CODE_MARKER}:(\\d+)`)
      );
      const markerIndex = pendingOutputRef.current.indexOf(COMMAND_MARKER);

      if (exitCodeMatch && markerIndex !== -1) {
        // Command completed - extract exit code and signal completion
        const exitCode = parseInt(exitCodeMatch[1], 10);
        setLastExitCode(exitCode);
        setIsRunning(false);

        // Calculate duration
        const duration = commandStartTimeRef.current
          ? Date.now() - commandStartTimeRef.current
          : 0;
        commandStartTimeRef.current = null;

        // Clear the pending buffer (streaming already sent the output)
        pendingOutputRef.current = "";
        onStateChange?.({ isRunning: false, lastExitCode: exitCode });
      } else {
        // Still waiting for markers - send output but filter any partial markers
        // Filter out lines containing our markers to prevent leakage
        const filteredText = text
          .split("\n")
          .filter(line => !line.includes(EXIT_CODE_MARKER) && !line.includes(COMMAND_MARKER))
          .join("\n");

        if (filteredText) {
          onOutput(filteredText, source);
        }
      }
    },
    [onOutput, onStateChange]
  );

  const execute = useCallback(
    async (command: string) => {
      if (!writerRef.current) {
        onError(new Error("Shell not initialized"));
        return;
      }

      setIsRunning(true);
      commandStartTimeRef.current = Date.now();
      onStateChange?.({ isRunning: true });

      try {
        const encoder = new TextEncoder();
        // Run command directly in the shell (not a subshell) to preserve aliases/functions from rc files
        // We capture the exit code separately since we need it after the command completes
        // The 2>&1 redirects stderr to stdout so we capture all output
        const fullCommand = `${command} 2>&1; echo "${EXIT_CODE_MARKER}:$?"; echo "${COMMAND_MARKER}"\n`;
        await writerRef.current.write(encoder.encode(fullCommand));
      } catch (err) {
        setIsRunning(false);
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [onError, onStateChange]
  );

  const write = useCallback(
    async (data: string) => {
      if (!writerRef.current) {
        return;
      }

      try {
        const encoder = new TextEncoder();
        await writerRef.current.write(encoder.encode(data));
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [onError]
  );

  const interrupt = useCallback(() => {
    if (processRef.current) {
      // Send SIGINT
      processRef.current.kill("SIGINT");
      setIsRunning(false);
      onStateChange?.({ isRunning: false });
    }
  }, [onStateChange]);

  const getPid = useCallback((): number | null => {
    return processRef.current?.pid ?? null;
  }, []);

  const getCwd = useCallback((): string => {
    return currentCwd;
  }, [currentCwd]);

  const getIsRunning = useCallback((): boolean => {
    return isRunning;
  }, [isRunning]);

  const getLastExitCode = useCallback((): number | null => {
    return lastExitCode;
  }, [lastExitCode]);

  const close = useCallback(() => {
    if (processRef.current) {
      processRef.current.kill();
      processRef.current = null;
    }
    if (writerRef.current) {
      writerRef.current.end();
      writerRef.current = null;
    }
  }, []);

  const getShell = useCallback((): string => {
    return shell;
  }, [shell]);

  return {
    execute,
    write,
    interrupt,
    getPid,
    getCwd,
    isRunning: getIsRunning,
    getLastExitCode,
    close,
    getShell,
  };
}
