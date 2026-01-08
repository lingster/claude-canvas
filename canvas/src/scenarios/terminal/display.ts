// Display-only Terminal Scenario
// Claude controls, user watches (view-only mode)

import type { ScenarioDefinition } from "../types";
import type { TerminalConfig, TerminalResult } from "../../canvases/terminal/types";

export const terminalDisplayScenario: ScenarioDefinition<
  TerminalConfig,
  TerminalResult
> = {
  name: "display",
  description: "Display-only terminal view (Claude controls, user watches)",
  canvasKind: "terminal",
  interactionMode: "view-only",
  closeOn: "command", // Closes when Claude sends close command
  defaultConfig: {
    shell: process.env.SHELL || "/bin/bash",
    cwd: process.env.HOME || "/",
    maxBufferLines: 10000,
    streamingEnabled: true, // Stream output for display mode
  },
};
