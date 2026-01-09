import { spawn, spawnSync } from "child_process";

export interface TerminalEnvironment {
  inTmux: boolean;
  summary: string;
}

export function detectTerminal(): TerminalEnvironment {
  const inTmux = !!process.env.TMUX;
  const summary = inTmux ? "tmux" : "no tmux";
  return { inTmux, summary };
}

export interface SpawnResult {
  method: string;
  pid?: number;
  paneId?: string;
}

export interface SpawnOptions {
  socketPath?: string;
  scenario?: string;
  forceNewPane?: boolean; // For terminals, always create new pane
  name?: string; // Custom pane title (defaults to pane index if not specified)
}

export interface TerminalConfig {
  cwd?: string;
  initialCommand?: string;
  shell?: string;
}

// Spawn a pure tmux terminal (real shell with PTY - supports SSH, vim, etc.)
export async function spawnTerminalPane(
  id: string,
  config?: TerminalConfig,
  options?: SpawnOptions
): Promise<SpawnResult> {
  const env = detectTerminal();

  if (!env.inTmux) {
    throw new Error("Terminal requires tmux. Please run inside a tmux session.");
  }

  const shell = config?.shell || process.env.SHELL || "/bin/zsh";
  const cwd = config?.cwd || process.env.HOME || "/";

  // Create tmux split with a real shell
  const result = await new Promise<SpawnTmuxResult>((resolve) => {
    // Use split-window -h for vertical split (side by side)
    // -c sets the working directory
    // -P -F prints the new pane ID
    const args = [
      "split-window", "-h", "-p", "67",
      "-c", cwd,
      "-P", "-F", "#{pane_id}",
      shell
    ];
    const proc = spawn("tmux", args);
    let paneId = "";
    proc.stdout?.on("data", (data) => {
      paneId += data.toString();
    });
    proc.on("close", async (code) => {
      if (code === 0 && paneId.trim()) {
        const trimmedPaneId = paneId.trim();
        await saveCanvasPaneId(trimmedPaneId, id, "terminal");
        // Set pane title
        const paneTitle = options?.name || getPaneIndex(trimmedPaneId);
        setPaneTitle(trimmedPaneId, paneTitle);
        resolve({ success: true, paneId: trimmedPaneId });
      } else {
        resolve({ success: false });
      }
    });
    proc.on("error", () => resolve({ success: false }));
  });

  if (!result.success || !result.paneId) {
    throw new Error("Failed to spawn tmux terminal pane");
  }

  // If initial command provided, send it after a short delay for shell to initialize
  if (config?.initialCommand) {
    await new Promise(resolve => setTimeout(resolve, 200));
    spawnSync("tmux", ["send-keys", "-t", result.paneId, config.initialCommand, "Enter"]);
  }

  return { method: "tmux", paneId: result.paneId };
}

// Execute a command in a tmux terminal pane
export function terminalExec(paneId: string, command: string): void {
  spawnSync("tmux", ["send-keys", "-t", paneId, command, "Enter"]);
}

// Get output from a tmux terminal pane
export function terminalGetOutput(paneId: string, lines: number = 50): string {
  const result = spawnSync("tmux", ["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]);
  return result.stdout?.toString() || "";
}

// Send interrupt (Ctrl+C) to a tmux terminal pane
export function terminalInterrupt(paneId: string): void {
  spawnSync("tmux", ["send-keys", "-t", paneId, "C-c"]);
}

export async function spawnCanvas(
  kind: string,
  id: string,
  configJson?: string,
  options?: SpawnOptions
): Promise<SpawnResult> {
  const env = detectTerminal();

  if (!env.inTmux) {
    throw new Error("Canvas requires tmux. Please run inside a tmux session.");
  }

  // For terminal kind, use pure tmux approach (real PTY)
  if (kind === "terminal") {
    const config: TerminalConfig = configJson ? JSON.parse(configJson) : {};
    return spawnTerminalPane(id, config, options);
  }

  // Get the directory of this script (skill directory)
  const scriptDir = import.meta.dir.replace("/src", "");
  const runScript = `${scriptDir}/run-canvas.sh`;

  // Auto-generate socket path for IPC if not provided
  const socketPath = options?.socketPath || `/tmp/canvas-${id}.sock`;

  // Build the command to run
  let command = `${runScript} show ${kind} --id ${id}`;
  if (configJson) {
    // Write config to a temp file to avoid shell escaping issues
    const configFile = `/tmp/canvas-config-${id}.json`;
    await Bun.write(configFile, configJson);
    command += ` --config "$(cat ${configFile})"`;
  }
  command += ` --socket ${socketPath}`;
  if (options?.scenario) {
    command += ` --scenario ${options.scenario}`;
  }

  const forceNew = options?.forceNewPane;

  const result = await spawnTmux(command, id, forceNew, options?.name);
  if (result.success) {
    return { method: "tmux", paneId: result.paneId };
  }

  throw new Error("Failed to spawn tmux pane");
}

// ============================================
// Multi-pane tracking
// ============================================

interface PaneInfo {
  id: string;        // Canvas ID
  paneId: string;    // tmux pane ID (e.g., %5)
  kind: string;      // Canvas kind (calendar, document, terminal, etc.)
  createdAt: number; // Timestamp
}

interface PaneRegistry {
  panes: Record<string, PaneInfo>;
  defaultPane?: string; // For backwards compatibility (non-terminal canvases)
}

const PANES_FILE = "/tmp/claude-canvas-panes.json";
// Keep old file for backwards compatibility during migration
const LEGACY_PANE_FILE = "/tmp/claude-canvas-pane-id";

async function loadPaneRegistry(): Promise<PaneRegistry> {
  try {
    const file = Bun.file(PANES_FILE);
    if (await file.exists()) {
      return JSON.parse(await file.text());
    }
  } catch {
    // Ignore parse errors
  }
  return { panes: {} };
}

async function savePaneRegistry(registry: PaneRegistry): Promise<void> {
  await Bun.write(PANES_FILE, JSON.stringify(registry, null, 2));
}

async function getCanvasPaneId(canvasId?: string): Promise<string | null> {
  const registry = await loadPaneRegistry();

  // If specific canvas ID requested
  if (canvasId && registry.panes[canvasId]) {
    const paneInfo = registry.panes[canvasId];
    if (await verifyPaneExists(paneInfo.paneId)) {
      return paneInfo.paneId;
    }
    // Clean up stale entry
    delete registry.panes[canvasId];
    await savePaneRegistry(registry);
    return null;
  }

  // Fall back to default pane for non-terminal canvases
  if (registry.defaultPane) {
    if (await verifyPaneExists(registry.defaultPane)) {
      return registry.defaultPane;
    }
    registry.defaultPane = undefined;
    await savePaneRegistry(registry);
  }

  // Try legacy file
  try {
    const legacyFile = Bun.file(LEGACY_PANE_FILE);
    if (await legacyFile.exists()) {
      const paneId = (await legacyFile.text()).trim();
      if (paneId && await verifyPaneExists(paneId)) {
        return paneId;
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

async function verifyPaneExists(paneId: string): Promise<boolean> {
  const result = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{pane_id}"]);
  const output = result.stdout?.toString().trim();
  return result.status === 0 && output === paneId;
}

function getPaneIndex(paneId: string): string {
  const result = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{pane_index}"]);
  return result.stdout?.toString().trim() || "0";
}

function setPaneTitle(paneId: string, title: string): void {
  spawnSync("tmux", ["select-pane", "-t", paneId, "-T", title]);
}

async function saveCanvasPaneId(
  paneId: string,
  canvasId: string,
  kind: string
): Promise<void> {
  const registry = await loadPaneRegistry();

  // Save pane info
  registry.panes[canvasId] = {
    id: canvasId,
    paneId,
    kind,
    createdAt: Date.now(),
  };

  // For non-terminal canvases, also set as default
  if (kind !== "terminal") {
    registry.defaultPane = paneId;
    // Legacy compatibility
    await Bun.write(LEGACY_PANE_FILE, paneId);
  }

  await savePaneRegistry(registry);
}

export async function listCanvasPanes(): Promise<PaneInfo[]> {
  const registry = await loadPaneRegistry();
  const validPanes: PaneInfo[] = [];

  for (const [id, info] of Object.entries(registry.panes)) {
    if (await verifyPaneExists(info.paneId)) {
      validPanes.push(info);
    } else {
      // Clean up stale entry
      delete registry.panes[id];
    }
  }

  // Save cleaned registry
  await savePaneRegistry(registry);
  return validPanes;
}

export async function closeCanvasPane(canvasId: string): Promise<boolean> {
  const registry = await loadPaneRegistry();
  const paneInfo = registry.panes[canvasId];

  if (!paneInfo) {
    return false;
  }

  // Kill the tmux pane
  const result = spawnSync("tmux", ["kill-pane", "-t", paneInfo.paneId]);

  // Remove from registry
  delete registry.panes[canvasId];
  if (registry.defaultPane === paneInfo.paneId) {
    registry.defaultPane = undefined;
  }
  await savePaneRegistry(registry);

  return result.status === 0;
}

interface SpawnTmuxResult {
  success: boolean;
  paneId?: string;
}

// Extract canvas ID from command (for pane tracking)
function extractCanvasId(command: string): { id: string; kind: string } {
  const idMatch = command.match(/--id\s+(\S+)/);
  const kindMatch = command.match(/show\s+(\S+)/);
  return {
    id: idMatch?.[1] || `canvas-${Date.now()}`,
    kind: kindMatch?.[1] || "unknown",
  };
}

async function createNewPane(
  command: string,
  canvasId: string,
  kind: string,
  name?: string
): Promise<SpawnTmuxResult> {
  return new Promise((resolve) => {
    // Use split-window -h for vertical split (side by side)
    // -p 67 gives canvas 2/3 width (1:2 ratio, Claude:Canvas)
    // -P -F prints the new pane ID so we can save it
    const args = ["split-window", "-h", "-p", "67", "-P", "-F", "#{pane_id}", command];
    const proc = spawn("tmux", args);
    let paneId = "";
    proc.stdout?.on("data", (data) => {
      paneId += data.toString();
    });
    proc.on("close", async (code) => {
      if (code === 0 && paneId.trim()) {
        const trimmedPaneId = paneId.trim();
        await saveCanvasPaneId(trimmedPaneId, canvasId, kind);
        // Set pane title: use provided name, or default to pane index
        const paneTitle = name || getPaneIndex(trimmedPaneId);
        setPaneTitle(trimmedPaneId, paneTitle);
        resolve({ success: true, paneId: trimmedPaneId });
      } else {
        resolve({ success: false });
      }
    });
    proc.on("error", () => resolve({ success: false }));
  });
}

async function reuseExistingPane(
  paneId: string,
  command: string
): Promise<SpawnTmuxResult> {
  return new Promise((resolve) => {
    // Send Ctrl+C to interrupt any running process
    const killProc = spawn("tmux", ["send-keys", "-t", paneId, "C-c"]);
    killProc.on("close", () => {
      // Wait for process to terminate before sending new command
      setTimeout(() => {
        // Clear the terminal and run the new command
        const args = ["send-keys", "-t", paneId, `clear && ${command}`, "Enter"];
        const proc = spawn("tmux", args);
        proc.on("close", (code) => {
          resolve({ success: code === 0, paneId: code === 0 ? paneId : undefined });
        });
        proc.on("error", () => resolve({ success: false }));
      }, 150);
    });
    killProc.on("error", () => resolve({ success: false }));
  });
}

async function spawnTmux(
  command: string,
  canvasId: string,
  forceNew: boolean = false,
  name?: string
): Promise<SpawnTmuxResult> {
  const { kind } = extractCanvasId(command);

  // For terminals or when forceNew is true, always create new pane
  if (forceNew) {
    return createNewPane(command, canvasId, kind, name);
  }

  // Check if we have an existing canvas pane to reuse
  const existingPaneId = await getCanvasPaneId();

  if (existingPaneId) {
    // Try to reuse existing pane
    const result = await reuseExistingPane(existingPaneId, command);
    if (result.success) {
      // Update registry with new canvas ID
      await saveCanvasPaneId(existingPaneId, canvasId, kind);
      // Update pane title if name provided
      if (name) {
        setPaneTitle(existingPaneId, name);
      }
      return result;
    }
  }

  // Create a new split pane
  return createNewPane(command, canvasId, kind, name);
}

