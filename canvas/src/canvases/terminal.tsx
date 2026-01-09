import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { useOutputBuffer } from "./terminal/hooks/use-output-buffer";
import { useShellSession } from "./terminal/hooks/use-shell-session";
import { useTerminalIPC } from "./terminal/hooks/use-terminal-ipc";
import { OutputView } from "./terminal/components/output-view";
import { InputLine } from "./terminal/components/input-line";
import { StatusBar } from "./terminal/components/status-bar";
import type { TerminalConfig, ShellState, ShellInfo, DEFAULT_TERMINAL_CONFIG } from "./terminal/types";

export interface TerminalProps {
  id: string;
  config?: TerminalConfig;
  socketPath?: string;
  scenario?: string;
}

export function Terminal({
  id,
  config: initialConfig,
  socketPath,
  scenario = "interactive",
}: TerminalProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Terminal dimensions
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns || 120,
    height: stdout?.rows || 40,
  });

  // Configuration with defaults
  const config = useMemo(
    () => ({
      shell: initialConfig?.shell || process.env.SHELL || "/bin/bash",
      cwd: initialConfig?.cwd || process.env.HOME || "/",
      env: initialConfig?.env,
      maxBufferLines: initialConfig?.maxBufferLines || 10000,
      streamingEnabled: initialConfig?.streamingEnabled || false,
      title: initialConfig?.title,
      initialCommand: initialConfig?.initialCommand,
    }),
    [initialConfig]
  );

  // Input state
  const [inputValue, setInputValue] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Shell state
  const [shellState, setShellState] = useState<ShellState>({
    isRunning: false,
    pid: null,
    lastExitCode: null,
    cwd: config.cwd,
    commandHistory: [],
  });

  // Track if initial command has been executed
  const initialCommandExecutedRef = React.useRef(false);

  // Streaming state
  const [streamingEnabled, setStreamingEnabled] = useState(
    config.streamingEnabled
  );

  // Output buffer
  const outputBuffer = useOutputBuffer({
    maxLines: config.maxBufferLines,
  });

  // Shell session
  const shell = useShellSession({
    shell: config.shell,
    cwd: config.cwd,
    env: config.env,
    onOutput: (chunk, source) => {
      outputBuffer.append(chunk, source);
      // If streaming enabled, IPC will handle it
    },
    onExit: (code) => {
      outputBuffer.append(`\nShell exited with code ${code}`, "system");
      exit();
    },
    onError: (error) => {
      outputBuffer.append(`Error: ${error.message}`, "system");
    },
    onStateChange: (state) => {
      setShellState((prev) => ({ ...prev, ...state }));
    },
  });

  // Helper functions for IPC
  const getShellInfo = useCallback((): ShellInfo => {
    return {
      pid: shell.getPid() || 0,
      shell: shell.getShell(),
      cwd: shell.getCwd(),
    };
  }, [shell]);

  const getTotalLines = useCallback((): number => {
    return outputBuffer.getTotalCount();
  }, [outputBuffer]);

  // IPC handler
  const ipc = useTerminalIPC({
    socketPath,
    scenario,
    onClose: () => {
      shell.close();
      exit();
    },
    onExecuteCommand: (command) => {
      outputBuffer.append(`$ ${command}`, "system");
      ipc.sendCommandStarted(command);
      shell.execute(command);
    },
    onGetOutput: (lineCount, fromEnd) => {
      return outputBuffer.getLines(lineCount, fromEnd);
    },
    onInterrupt: () => {
      shell.interrupt();
      outputBuffer.append("^C", "system");
    },
    onSetStreaming: (enabled) => {
      setStreamingEnabled(enabled);
    },
    onInput: (data) => {
      shell.write(data);
    },
    getShellInfo,
    getTotalLines,
  });

  // Track shell state changes for IPC
  useEffect(() => {
    if (!shellState.isRunning && shellState.lastExitCode !== null) {
      ipc.sendCommandComplete(shellState.lastExitCode, 0);
    }
  }, [shellState.isRunning, shellState.lastExitCode, ipc]);

  // Stream output if enabled
  useEffect(() => {
    if (streamingEnabled && ipc.isStreamingEnabled()) {
      const lines = outputBuffer.getAll();
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        ipc.sendOutput(lastLine.content, lastLine.source);
      }
    }
  }, [outputBuffer.getBufferSize(), streamingEnabled, ipc]);

  // Terminal resize handling
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: stdout?.columns || 120,
        height: stdout?.rows || 40,
      });
    };

    stdout?.on("resize", updateDimensions);
    return () => {
      stdout?.off("resize", updateDimensions);
    };
  }, [stdout]);

  // Execute command from user input
  const executeCommand = useCallback(
    (command: string) => {
      if (!command.trim()) return;

      // Add to history
      setCommandHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);

      // Show command in output
      outputBuffer.append(`$ ${command}`, "system");

      // Notify IPC
      ipc.sendCommandStarted(command);

      // Execute
      shell.execute(command);

      // Clear input
      setInputValue("");
      setCursorPosition(0);
    },
    [shell, outputBuffer, ipc]
  );

  // Send ready when shell is initialized and execute initial command if provided
  useEffect(() => {
    const pid = shell.getPid();
    if (pid) {
      ipc.sendReady();

      // Execute initial command if provided and not already executed
      if (config.initialCommand && !initialCommandExecutedRef.current) {
        initialCommandExecutedRef.current = true;
        // Small delay to ensure shell is fully ready after sourcing rc files
        setTimeout(() => {
          executeCommand(config.initialCommand!);
        }, 100);
      }
    }
  }, [shell.getPid(), ipc, config.initialCommand, executeCommand]);

  // Keyboard input handling
  useInput((input, key) => {
    // Handle escape - quit
    if (key.escape) {
      ipc.sendCancelled("User quit");
      shell.close();
      exit();
      return;
    }

    // If command is running, only handle Ctrl+C
    if (shellState.isRunning) {
      if (key.ctrl && input === "c") {
        shell.interrupt();
        outputBuffer.append("^C", "system");
      }
      return;
    }

    // Handle enter - execute command
    if (key.return) {
      executeCommand(inputValue);
      return;
    }

    // Handle Ctrl+C - interrupt or clear line
    if (key.ctrl && input === "c") {
      if (inputValue) {
        setInputValue("");
        setCursorPosition(0);
        outputBuffer.append("^C", "system");
      } else {
        shell.interrupt();
      }
      return;
    }

    // Handle Ctrl+L - clear screen
    if (key.ctrl && input === "l") {
      outputBuffer.clear();
      return;
    }

    // Handle backspace
    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        setInputValue(
          (prev) =>
            prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition)
        );
        setCursorPosition((prev) => prev - 1);
      }
      return;
    }

    // Handle left arrow
    if (key.leftArrow) {
      setCursorPosition((prev) => Math.max(0, prev - 1));
      return;
    }

    // Handle right arrow
    if (key.rightArrow) {
      setCursorPosition((prev) => Math.min(inputValue.length, prev + 1));
      return;
    }

    // Handle up arrow - history
    if (key.upArrow) {
      if (commandHistory.length > 0) {
        const newIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[newIndex]);
        setCursorPosition(commandHistory[newIndex].length);
      }
      return;
    }

    // Handle down arrow - history
    if (key.downArrow) {
      if (historyIndex !== -1) {
        if (historyIndex < commandHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setInputValue(commandHistory[newIndex]);
          setCursorPosition(commandHistory[newIndex].length);
        } else {
          setHistoryIndex(-1);
          setInputValue("");
          setCursorPosition(0);
        }
      }
      return;
    }

    // Handle home key
    if (key.ctrl && input === "a") {
      setCursorPosition(0);
      return;
    }

    // Handle end key
    if (key.ctrl && input === "e") {
      setCursorPosition(inputValue.length);
      return;
    }

    // Handle regular character input
    if (input && !key.ctrl && !key.meta) {
      setInputValue(
        (prev) =>
          prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition)
      );
      setCursorPosition((prev) => prev + input.length);
    }
  });

  // Get visible lines for output view
  const outputLines = outputBuffer.getAll();

  // Calculate title
  const title = config.title || id;
  const shellName = shell.getShell().split("/").pop() || "shell";
  const cwd = shell.getCwd();

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
    >
      {/* Title bar */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color="cyan">
          TERMINAL: {title}
        </Text>
        <Text color="gray">
          [{shellName}] {cwd}
        </Text>
      </Box>

      {/* Output area */}
      <Box flexGrow={1} flexDirection="column">
        <OutputView
          lines={outputLines}
          width={dimensions.width}
          height={dimensions.height - 4}
        />
      </Box>

      {/* Input line */}
      <Box paddingX={1}>
        <InputLine
          value={inputValue}
          cursorPosition={cursorPosition}
          width={dimensions.width - 2}
          isRunning={shellState.isRunning}
        />
      </Box>

      {/* Status bar */}
      <StatusBar
        isRunning={shellState.isRunning}
        bufferSize={outputBuffer.getBufferSize()}
        maxBufferSize={config.maxBufferLines}
        pid={shell.getPid()}
        lastExitCode={shellState.lastExitCode}
        cwd={cwd}
        width={dimensions.width}
        isConnected={ipc.isConnected}
        streamingEnabled={streamingEnabled}
      />
    </Box>
  );
}

export type { TerminalConfig } from "./terminal/types";
