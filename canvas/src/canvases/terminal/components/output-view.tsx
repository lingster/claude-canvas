import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { OutputLine } from "../types";

export interface OutputViewProps {
  lines: OutputLine[];
  width: number;
  height: number;
  scrollOffset?: number;
}

// Simple ANSI color mapping for Ink
const ANSI_COLORS: Record<string, string> = {
  "30": "black",
  "31": "red",
  "32": "green",
  "33": "yellow",
  "34": "blue",
  "35": "magenta",
  "36": "cyan",
  "37": "white",
  "90": "gray",
  "91": "redBright",
  "92": "greenBright",
  "93": "yellowBright",
  "94": "blueBright",
  "95": "magentaBright",
  "96": "cyanBright",
  "97": "whiteBright",
};

interface TextSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

// Parse ANSI escape codes into styled segments
function parseAnsiLine(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Match ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentColor: string | undefined;
  let bold = false;
  let dim = false;

  let match;
  while ((match = ansiRegex.exec(line)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: line.slice(lastIndex, match.index),
        color: currentColor,
        bold,
        dim,
      });
    }

    // Parse the escape codes
    const codes = match[1].split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentColor = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code >= 30 && code <= 37) {
        currentColor = ANSI_COLORS[String(code)];
      } else if (code >= 90 && code <= 97) {
        currentColor = ANSI_COLORS[String(code)];
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < line.length) {
    segments.push({
      text: line.slice(lastIndex),
      color: currentColor,
      bold,
      dim,
    });
  }

  // If empty line, add a space to ensure it renders
  if (segments.length === 0 || (segments.length === 1 && segments[0].text === "")) {
    segments.push({ text: " " });
  }

  return segments;
}

// Strip ANSI codes for length calculation
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function OutputView({
  lines,
  width,
  height,
  scrollOffset = 0,
}: OutputViewProps): React.ReactElement {
  // Calculate visible lines based on scroll offset
  const visibleLines = useMemo(() => {
    // Reserve 2 lines for input and status bar
    const viewHeight = Math.max(1, height - 3);

    // Calculate which lines to show
    const totalLines = lines.length;
    const startIndex = Math.max(
      0,
      Math.min(scrollOffset, totalLines - viewHeight)
    );
    const endIndex = Math.min(startIndex + viewHeight, totalLines);

    return lines.slice(startIndex, endIndex);
  }, [lines, height, scrollOffset]);

  return (
    <Box flexDirection="column" flexGrow={1} width={width}>
      {visibleLines.map((line, index) => (
        <Box key={`${line.timestamp}-${index}`} width={width}>
          <OutputLineComponent line={line} width={width} />
        </Box>
      ))}
    </Box>
  );
}

interface OutputLineComponentProps {
  line: OutputLine;
  width: number;
}

function OutputLineComponent({
  line,
  width,
}: OutputLineComponentProps): React.ReactElement {
  const segments = useMemo(() => parseAnsiLine(line.content), [line.content]);

  // Truncate if needed
  const visibleWidth = width - 1;
  let currentWidth = 0;
  const truncatedSegments: TextSegment[] = [];

  for (const segment of segments) {
    const strippedText = stripAnsi(segment.text);
    if (currentWidth + strippedText.length <= visibleWidth) {
      truncatedSegments.push(segment);
      currentWidth += strippedText.length;
    } else {
      // Truncate this segment
      const remaining = visibleWidth - currentWidth;
      if (remaining > 0) {
        truncatedSegments.push({
          ...segment,
          text: segment.text.slice(0, remaining),
        });
      }
      break;
    }
  }

  // Color stderr differently
  const baseColor = line.source === "stderr" ? "red" : undefined;
  const isSystem = line.source === "system";

  return (
    <Text wrap="truncate">
      {truncatedSegments.map((segment, idx) => (
        <Text
          key={idx}
          color={segment.color || baseColor}
          bold={segment.bold}
          dimColor={segment.dim || isSystem}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}
