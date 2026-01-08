import React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  isRunning: boolean;
  bufferSize: number;
  maxBufferSize: number;
  pid: number | null;
  lastExitCode: number | null;
  cwd?: string;
  width: number;
  isConnected?: boolean;
  streamingEnabled?: boolean;
}

export function StatusBar({
  isRunning,
  bufferSize,
  maxBufferSize,
  pid,
  lastExitCode,
  cwd,
  width,
  isConnected = false,
  streamingEnabled = false,
}: StatusBarProps): React.ReactElement {
  // Build status segments
  const statusText = isRunning ? "RUNNING" : "IDLE";
  const statusColor = isRunning ? "yellow" : "green";

  const exitCodeText =
    lastExitCode !== null
      ? lastExitCode === 0
        ? "OK"
        : `Exit: ${lastExitCode}`
      : "";
  const exitCodeColor = lastExitCode === 0 ? "green" : "red";

  const bufferText = `Lines: ${bufferSize}/${maxBufferSize}`;
  const pidText = pid ? `PID: ${pid}` : "";

  const connectionText = isConnected ? "IPC" : "";
  const streamText = streamingEnabled ? "STREAM" : "";

  // Build the status line with separators
  const segments: Array<{ text: string; color?: string }> = [
    { text: `[${statusText}]`, color: statusColor },
  ];

  if (exitCodeText) {
    segments.push({ text: exitCodeText, color: exitCodeColor });
  }

  segments.push({ text: bufferText, color: "cyan" });

  if (pidText) {
    segments.push({ text: pidText, color: "gray" });
  }

  if (connectionText) {
    segments.push({ text: connectionText, color: "green" });
  }

  if (streamText) {
    segments.push({ text: streamText, color: "magenta" });
  }

  // Keyboard shortcuts on the right
  const shortcuts = "Esc:quit  Ctrl+C:int";

  // Calculate spacing
  const leftContent = segments.map((s) => s.text).join(" | ");
  const totalContentLength = leftContent.length + shortcuts.length + 3;
  const padding = Math.max(0, width - totalContentLength);

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      width={width}
    >
      <Box flexGrow={1}>
        {segments.map((segment, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && (
              <Text color="gray"> | </Text>
            )}
            <Text color={segment.color as any}>{segment.text}</Text>
          </React.Fragment>
        ))}
      </Box>
      <Text color="gray">{shortcuts}</Text>
    </Box>
  );
}
