// Terminal-specific IPC hook extending the base IPC server pattern

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "ink";
import { createIPCServer, type IPCServer } from "../../../ipc/server";
import type { ControllerMessage, OutputLineData } from "../../../ipc/types";
import type { OutputLine, ShellInfo } from "../types";

export interface UseTerminalIPCOptions {
  socketPath: string | undefined;
  scenario: string;
  onClose?: () => void;
  onExecuteCommand: (command: string) => void;
  onGetOutput: (lineCount?: number, fromEnd?: boolean) => OutputLine[];
  onInterrupt: () => void;
  onSetStreaming: (enabled: boolean) => void;
  onInput: (data: string) => void;
  getShellInfo: () => ShellInfo;
  getTotalLines: () => number;
}

export interface TerminalIPCHandle {
  isConnected: boolean;
  sendReady: () => void;
  sendOutput: (chunk: string, source: "stdout" | "stderr") => void;
  sendOutputBuffer: (lines: OutputLine[], totalAvailable: number) => void;
  sendCommandStarted: (command: string) => void;
  sendCommandComplete: (exitCode: number, duration: number) => void;
  sendError: (message: string) => void;
  sendCancelled: (reason?: string) => void;
  isStreamingEnabled: () => boolean;
}

export function useTerminalIPC(
  options: UseTerminalIPCOptions
): TerminalIPCHandle {
  const {
    socketPath,
    scenario,
    onClose,
    onExecuteCommand,
    onGetOutput,
    onInterrupt,
    onSetStreaming,
    onInput,
    getShellInfo,
    getTotalLines,
  } = options;

  const { exit } = useApp();
  const [isConnected, setIsConnected] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  const serverRef = useRef<IPCServer | null>(null);

  // Keep refs to callbacks to avoid stale closures
  const onCloseRef = useRef(onClose);
  const onExecuteCommandRef = useRef(onExecuteCommand);
  const onGetOutputRef = useRef(onGetOutput);
  const onInterruptRef = useRef(onInterrupt);
  const onSetStreamingRef = useRef(onSetStreaming);
  const onInputRef = useRef(onInput);
  const getShellInfoRef = useRef(getShellInfo);
  const getTotalLinesRef = useRef(getTotalLines);

  useEffect(() => {
    onCloseRef.current = onClose;
    onExecuteCommandRef.current = onExecuteCommand;
    onGetOutputRef.current = onGetOutput;
    onInterruptRef.current = onInterrupt;
    onSetStreamingRef.current = onSetStreaming;
    onInputRef.current = onInput;
    getShellInfoRef.current = getShellInfo;
    getTotalLinesRef.current = getTotalLines;
  }, [
    onClose,
    onExecuteCommand,
    onGetOutput,
    onInterrupt,
    onSetStreaming,
    onInput,
    getShellInfo,
    getTotalLines,
  ]);

  // Start server on mount
  useEffect(() => {
    if (!socketPath) return;

    let mounted = true;

    const startServer = async () => {
      try {
        const server = await createIPCServer({
          socketPath,
          onMessage: (msg: ControllerMessage) => {
            switch (msg.type) {
              case "close":
                onCloseRef.current?.();
                exit();
                break;

              case "ping":
                server.broadcast({ type: "pong" });
                break;

              // Terminal-specific messages
              case "executeCommand":
                onExecuteCommandRef.current(msg.command);
                break;

              case "getOutput": {
                const lines = onGetOutputRef.current(
                  msg.lineCount,
                  msg.fromEnd ?? true
                );
                const outputLines: OutputLineData[] = lines.map((line) => ({
                  content: line.content,
                  timestamp: line.timestamp,
                  source: line.source,
                }));
                server.broadcast({
                  type: "outputBuffer",
                  lines: outputLines,
                  totalAvailable: getTotalLinesRef.current(),
                });
                break;
              }

              case "interrupt":
                onInterruptRef.current();
                break;

              case "setStreaming":
                setStreamingEnabled(msg.enabled);
                onSetStreamingRef.current(msg.enabled);
                break;

              case "terminalInput":
                onInputRef.current(msg.data);
                break;

              // Ignore non-terminal messages
              case "update":
              case "getSelection":
              case "getContent":
                break;
            }
          },
          onClientConnect: () => {
            if (mounted) {
              setIsConnected(true);
            }
          },
          onClientDisconnect: () => {
            if (mounted) {
              setIsConnected(false);
            }
          },
          onError: (err) => {
            console.error("Terminal IPC error:", err);
          },
        });

        if (mounted) {
          serverRef.current = server;
        } else {
          server.close();
        }
      } catch (err) {
        console.error("Failed to start terminal IPC server:", err);
      }
    };

    startServer();

    return () => {
      mounted = false;
      serverRef.current?.close();
      serverRef.current = null;
    };
  }, [socketPath, exit]);

  const sendReady = useCallback(() => {
    const shellInfo = getShellInfoRef.current();
    serverRef.current?.broadcast({
      type: "terminalReady",
      scenario,
      shellInfo,
    });
  }, [scenario]);

  const sendOutput = useCallback(
    (chunk: string, source: "stdout" | "stderr") => {
      if (streamingEnabled) {
        serverRef.current?.broadcast({
          type: "output",
          chunk,
          source,
        });
      }
    },
    [streamingEnabled]
  );

  const sendOutputBuffer = useCallback(
    (lines: OutputLine[], totalAvailable: number) => {
      const outputLines: OutputLineData[] = lines.map((line) => ({
        content: line.content,
        timestamp: line.timestamp,
        source: line.source,
      }));
      serverRef.current?.broadcast({
        type: "outputBuffer",
        lines: outputLines,
        totalAvailable,
      });
    },
    []
  );

  const sendCommandStarted = useCallback((command: string) => {
    serverRef.current?.broadcast({
      type: "commandStarted",
      command,
    });
  }, []);

  const sendCommandComplete = useCallback(
    (exitCode: number, duration: number) => {
      serverRef.current?.broadcast({
        type: "commandComplete",
        exitCode,
        duration,
      });
    },
    []
  );

  const sendError = useCallback((message: string) => {
    serverRef.current?.broadcast({
      type: "error",
      message,
    });
  }, []);

  const sendCancelled = useCallback((reason?: string) => {
    serverRef.current?.broadcast({
      type: "cancelled",
      reason,
    });
  }, []);

  const isStreamingEnabledFn = useCallback(() => {
    return streamingEnabled;
  }, [streamingEnabled]);

  return {
    isConnected,
    sendReady,
    sendOutput,
    sendOutputBuffer,
    sendCommandStarted,
    sendCommandComplete,
    sendError,
    sendCancelled,
    isStreamingEnabled: isStreamingEnabledFn,
  };
}
