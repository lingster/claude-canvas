import React from "react";
import { Box, Text } from "ink";

export interface InputLineProps {
  value: string;
  cursorPosition: number;
  width: number;
  prompt?: string;
  isRunning?: boolean;
}

export function InputLine({
  value,
  cursorPosition,
  width,
  prompt = "$ ",
  isRunning = false,
}: InputLineProps): React.ReactElement {
  // Calculate visible portion of input if it overflows
  const promptWidth = prompt.length;
  const availableWidth = width - promptWidth - 2;

  let displayValue = value;
  let displayCursor = cursorPosition;

  // If cursor is beyond visible area, scroll the input
  if (cursorPosition > availableWidth) {
    const scrollOffset = cursorPosition - availableWidth + 10;
    displayValue = value.slice(scrollOffset);
    displayCursor = cursorPosition - scrollOffset;
  }

  // Truncate if needed
  if (displayValue.length > availableWidth) {
    displayValue = displayValue.slice(0, availableWidth);
  }

  // Split value at cursor for rendering
  const beforeCursor = displayValue.slice(0, displayCursor);
  const atCursor = displayValue[displayCursor] || " ";
  const afterCursor = displayValue.slice(displayCursor + 1);

  if (isRunning) {
    return (
      <Box>
        <Text dimColor>{prompt}</Text>
        <Text dimColor italic>
          (running...)
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="green" bold>
        {prompt}
      </Text>
      <Text>{beforeCursor}</Text>
      <Text backgroundColor="white" color="black">
        {atCursor}
      </Text>
      <Text>{afterCursor}</Text>
    </Box>
  );
}
