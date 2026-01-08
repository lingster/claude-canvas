// Interactive Terminal Scenario
// Hybrid mode: Claude + user can both send commands

import type { ScenarioDefinition } from "../types";
import type { TerminalConfig, TerminalResult } from "../../canvases/terminal/types";

export const terminalInteractiveScenario: ScenarioDefinition<
  TerminalConfig,
  TerminalResult
> = {
  name: "interactive",
  description: "Interactive terminal with hybrid input (Claude + user)",
  canvasKind: "terminal",
  interactionMode: "selection", // User can interact
  closeOn: "escape",
  defaultConfig: {
    shell: process.env.SHELL || "/bin/bash",
    cwd: process.env.HOME || "/",
    maxBufferLines: 10000,
    streamingEnabled: false,
  },
};
