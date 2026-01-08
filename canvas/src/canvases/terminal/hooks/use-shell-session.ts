import { useEffect, useRef, useCallback, useState } from "react";
import { spawn, type Subprocess } from "bun";
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
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [currentCwd, setCurrentCwd] = useState(cwd);
  const commandStartTimeRef = useRef<number | null>(null);
  const pendingOutputRef = useRef<string>("");

  // Start shell process on mount
  useEffect(() => {
    const startShell = async () => {
      try {
        // Use script command for pseudo-TTY on macOS/Linux
        const isLinux = process.platform === "linux";
        const scriptArgs = isLinux
          ? ["script", "-q", "-c", shell, "/dev/null"]
          : ["script", "-q", "/dev/null", shell];

        const proc = spawn({
          cmd: scriptArgs,
          cwd,
          env: {
            ...process.env,
            ...env,
            TERM: "xterm-256color",
            // Ensure shell doesn't use complex prompts that interfere
            PS1: "$ ",
            PS2: "> ",
          },
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        processRef.current = proc;

        // Get writer for stdin
        if (proc.stdin) {
          writerRef.current = proc.stdin.getWriter();
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
        // Command completed
        const exitCode = parseInt(exitCodeMatch[1], 10);
        setLastExitCode(exitCode);
        setIsRunning(false);

        // Calculate duration
        const duration = commandStartTimeRef.current
          ? Date.now() - commandStartTimeRef.current
          : 0;
        commandStartTimeRef.current = null;

        // Remove markers from output
        let cleanOutput = pendingOutputRef.current
          .replace(new RegExp(`${EXIT_CODE_MARKER}:\\d+\\n?`), "")
          .replace(new RegExp(`${COMMAND_MARKER}\\n?`), "");

        // Send cleaned output
        if (cleanOutput.trim()) {
          onOutput(cleanOutput, source);
        }

        pendingOutputRef.current = "";
        onStateChange?.({ isRunning: false, lastExitCode: exitCode });
      } else {
        // Still accumulating or no marker system in use
        // For now, just forward output directly
        onOutput(text, source);
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
        // Send the command followed by exit code capture and marker
        // This allows us to detect when the command completes
        const fullCommand = `${command}; echo "${EXIT_CODE_MARKER}:$?"; echo "${COMMAND_MARKER}"\n`;
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
      writerRef.current.close();
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
