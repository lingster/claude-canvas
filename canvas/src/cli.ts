#!/usr/bin/env bun
import { program } from "commander";
import { detectTerminal, spawnCanvas, listCanvasPanes, closeCanvasPane } from "./terminal";

// Set window title via ANSI escape codes
function setWindowTitle(title: string) {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

program
  .name("claude-canvas")
  .description("Interactive terminal canvases for Claude")
  .version("1.0.0");

program
  .command("show [kind]")
  .description("Show a canvas in the current terminal")
  .option("--id <id>", "Canvas ID")
  .option("--config <json>", "Canvas configuration (JSON)")
  .option("--socket <path>", "Unix socket path for IPC")
  .option("--scenario <name>", "Scenario name (e.g., display, meeting-picker)")
  .action(async (kind = "demo", options) => {
    const id = options.id || `${kind}-1`;
    const config = options.config ? JSON.parse(options.config) : undefined;
    const socketPath = options.socket;
    const scenario = options.scenario || "display";

    // Set window title
    setWindowTitle(`canvas: ${kind}`);

    // Dynamically import and render the canvas
    const { renderCanvas } = await import("./canvases");
    await renderCanvas(kind, id, config, { socketPath, scenario });
  });

program
  .command("spawn [kind]")
  .description("Spawn a canvas in a new terminal window")
  .option("--id <id>", "Canvas ID")
  .option("--config <json>", "Canvas configuration (JSON)")
  .option("--socket <path>", "Unix socket path for IPC")
  .option("--scenario <name>", "Scenario name (e.g., display, meeting-picker)")
  .option("--name <title>", "Pane title (defaults to pane index if not specified)")
  .action(async (kind = "demo", options) => {
    const id = options.id || `${kind}-1`;
    const result = await spawnCanvas(kind, id, options.config, {
      socketPath: options.socket,
      scenario: options.scenario,
      name: options.name,
    });
    console.log(`Spawned ${kind} canvas '${id}' via ${result.method}`);
  });

program
  .command("env")
  .description("Show detected terminal environment")
  .action(() => {
    const env = detectTerminal();
    console.log("Terminal Environment:");
    console.log(`  In tmux: ${env.inTmux}`);
    console.log(`\nSummary: ${env.summary}`);
  });

program
  .command("update <id>")
  .description("Send updated config to a running canvas via IPC")
  .option("--config <json>", "New canvas configuration (JSON)")
  .action(async (id: string, options) => {
    const { getSocketPath } = await import("./ipc/types");
    const socketPath = getSocketPath(id);
    const config = options.config ? JSON.parse(options.config) : {};

    try {
      const socket = await Bun.connect({
        unix: socketPath,
        socket: {
          data(socket, data) {
            // Ignore responses
          },
          open(socket) {
            const msg = JSON.stringify({ type: "update", config });
            socket.write(msg + "\n");
            socket.end();
          },
          close() {},
          error(socket, error) {
            console.error("Socket error:", error);
          },
        },
      });
      console.log(`Sent update to canvas '${id}'`);
    } catch (err) {
      console.error(`Failed to connect to canvas '${id}':`, err);
    }
  });

program
  .command("selection <id>")
  .description("Get the current selection from a running document canvas")
  .action(async (id: string) => {
    const { getSocketPath } = await import("./ipc/types");
    const socketPath = getSocketPath(id);

    try {
      let resolved = false;
      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error("Timeout waiting for response"));
          }
        }, 2000);

        Bun.connect({
          unix: socketPath,
          socket: {
            data(socket, data) {
              if (resolved) return;
              clearTimeout(timeout);
              resolved = true;
              const response = JSON.parse(data.toString().trim());
              if (response.type === "selection") {
                resolve(JSON.stringify(response.data));
              } else {
                resolve(JSON.stringify(null));
              }
              socket.end();
            },
            open(socket) {
              const msg = JSON.stringify({ type: "getSelection" });
              socket.write(msg + "\n");
            },
            close() {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(JSON.stringify(null));
              }
            },
            error(socket, error) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(error);
              }
            },
          },
        });
      });
      console.log(result);
    } catch (err) {
      console.error(`Failed to get selection from canvas '${id}':`, err);
      process.exit(1);
    }
  });

program
  .command("content <id>")
  .description("Get the current content from a running document canvas")
  .action(async (id: string) => {
    const { getSocketPath } = await import("./ipc/types");
    const socketPath = getSocketPath(id);

    try {
      let resolved = false;
      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            reject(new Error("Timeout waiting for response"));
          }
        }, 2000);

        Bun.connect({
          unix: socketPath,
          socket: {
            data(socket, data) {
              if (resolved) return;
              clearTimeout(timeout);
              resolved = true;
              const response = JSON.parse(data.toString().trim());
              if (response.type === "content") {
                resolve(JSON.stringify(response.data));
              } else {
                resolve(JSON.stringify(null));
              }
              socket.end();
            },
            open(socket) {
              const msg = JSON.stringify({ type: "getContent" });
              socket.write(msg + "\n");
            },
            close() {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(JSON.stringify(null));
              }
            },
            error(socket, error) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(error);
              }
            },
          },
        });
      });
      console.log(result);
    } catch (err) {
      console.error(`Failed to get content from canvas '${id}':`, err);
      process.exit(1);
    }
  });

// ============================================
// Terminal-specific commands (pure tmux - no IPC needed)
// ============================================

// Helper to get pane ID from canvas ID
async function getTerminalPaneId(canvasId: string): Promise<string | null> {
  const panes = await listCanvasPanes();
  const pane = panes.find(p => p.id === canvasId);
  return pane?.paneId || null;
}

program
  .command("terminal-exec <id> <command>")
  .description("Execute a command in a terminal pane")
  .action(async (id: string, command: string) => {
    const paneId = await getTerminalPaneId(id);
    if (!paneId) {
      console.error(`Terminal '${id}' not found`);
      process.exit(1);
    }

    const { terminalExec } = await import("./terminal");
    terminalExec(paneId, command);
    console.log(`Sent command to terminal '${id}'`);
  });

program
  .command("terminal-output <id>")
  .description("Get the last N lines of output from a terminal pane")
  .option("--lines <n>", "Number of lines to retrieve", "50")
  .action(async (id: string, options) => {
    const paneId = await getTerminalPaneId(id);
    if (!paneId) {
      console.error(`Terminal '${id}' not found`);
      process.exit(1);
    }

    const { terminalGetOutput } = await import("./terminal");
    const lineCount = parseInt(options.lines, 10);
    const output = terminalGetOutput(paneId, lineCount);
    console.log(output);
  });

program
  .command("terminal-interrupt <id>")
  .description("Send interrupt (Ctrl+C) to a terminal pane")
  .action(async (id: string) => {
    const paneId = await getTerminalPaneId(id);
    if (!paneId) {
      console.error(`Terminal '${id}' not found`);
      process.exit(1);
    }

    const { terminalInterrupt } = await import("./terminal");
    terminalInterrupt(paneId);
    console.log(`Sent interrupt to terminal '${id}'`);
  });

program
  .command("panes")
  .description("List all active canvas panes")
  .action(async () => {
    const panes = await listCanvasPanes();
    if (panes.length === 0) {
      console.log("No active canvas panes");
      return;
    }
    console.log("Active canvas panes:");
    for (const pane of panes) {
      const age = Math.round((Date.now() - pane.createdAt) / 1000);
      console.log(`  ${pane.id} (${pane.kind}) - pane ${pane.paneId} - ${age}s ago`);
    }
  });

program
  .command("close <id>")
  .description("Close a canvas pane by ID")
  .action(async (id: string) => {
    const success = await closeCanvasPane(id);
    if (success) {
      console.log(`Closed canvas pane '${id}'`);
    } else {
      console.error(`Failed to close canvas pane '${id}' (not found or already closed)`);
      process.exit(1);
    }
  });

program.parse();
