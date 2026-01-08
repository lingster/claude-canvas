import { useState, useCallback, useRef } from "react";
import type { OutputLine } from "../types";

export interface UseOutputBufferOptions {
  maxLines?: number; // Default 10000
}

export interface OutputBufferHandle {
  append: (content: string, source: "stdout" | "stderr" | "system") => void;
  appendLine: (line: OutputLine) => void;
  getLines: (count?: number, fromEnd?: boolean) => OutputLine[];
  getAll: () => OutputLine[];
  clear: () => void;
  getTotalCount: () => number;
  getBufferSize: () => number;
}

const DEFAULT_MAX_LINES = 10000;

export function useOutputBuffer(
  options: UseOutputBufferOptions = {}
): OutputBufferHandle {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const [lines, setLines] = useState<OutputLine[]>([]);
  const totalCountRef = useRef(0);

  const appendLine = useCallback(
    (line: OutputLine) => {
      totalCountRef.current += 1;
      setLines((prev) => {
        const newLines = [...prev, line];
        // Trim to max size (circular buffer behavior)
        if (newLines.length > maxLines) {
          return newLines.slice(newLines.length - maxLines);
        }
        return newLines;
      });
    },
    [maxLines]
  );

  const append = useCallback(
    (content: string, source: "stdout" | "stderr" | "system") => {
      // Split content by newlines and create individual lines
      const contentLines = content.split("\n");
      const newLines: OutputLine[] = [];
      const timestamp = Date.now();

      for (let i = 0; i < contentLines.length; i++) {
        const lineContent = contentLines[i];
        // Skip empty strings that result from split (but keep actual empty lines)
        if (i === contentLines.length - 1 && lineContent === "") {
          continue;
        }
        newLines.push({
          content: lineContent,
          timestamp,
          source,
        });
      }

      if (newLines.length === 0) return;

      totalCountRef.current += newLines.length;
      setLines((prev) => {
        const combined = [...prev, ...newLines];
        if (combined.length > maxLines) {
          return combined.slice(combined.length - maxLines);
        }
        return combined;
      });
    },
    [maxLines]
  );

  const getLines = useCallback(
    (count?: number, fromEnd = true): OutputLine[] => {
      if (!count) return lines;

      if (fromEnd) {
        return lines.slice(-count);
      }
      return lines.slice(0, count);
    },
    [lines]
  );

  const getAll = useCallback((): OutputLine[] => {
    return lines;
  }, [lines]);

  const clear = useCallback(() => {
    setLines([]);
    totalCountRef.current = 0;
  }, []);

  const getTotalCount = useCallback((): number => {
    return totalCountRef.current;
  }, []);

  const getBufferSize = useCallback((): number => {
    return lines.length;
  }, [lines]);

  return {
    append,
    appendLine,
    getLines,
    getAll,
    clear,
    getTotalCount,
    getBufferSize,
  };
}
