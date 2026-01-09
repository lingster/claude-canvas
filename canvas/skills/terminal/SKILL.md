# Terminal Canvas

Interactive terminal canvas for running shell commands and viewing output. Supports multiple concurrent terminals, persistent shell sessions, and hybrid input (Claude + user).

## Spawning a Terminal

```bash
# Spawn a new terminal with a unique ID
spawn terminal --id webserver --scenario interactive

# Spawn with custom working directory
spawn terminal --id myterm --config '{"cwd": "/path/to/project"}'

# Spawn with a custom pane name/title
spawn terminal --id myterm --name "backend"
```

Each terminal gets its own tmux pane and maintains an independent shell session.

## Pane Naming

Each pane can have a title for easier identification. The title is set via tmux's `pane_title` property.

```bash
# Spawn with a custom name
spawn terminal --id server --name "backend"

# If no name is specified, the pane index (0, 1, 2...) is used as the default title
spawn terminal --id myterm  # Title will be the pane index
```

To manually set or change a pane title after creation:
```bash
tmux select-pane -t <pane_id> -T "new-title"
```

To view pane titles:
```bash
tmux list-panes -F "Pane #{pane_index}: #{pane_title}"
```

## Sending Commands

Claude can send commands to any running terminal by ID:

```bash
# Execute a command
terminal-exec webserver "npm run dev"

# Execute in a different terminal
terminal-exec testrunner "npm test"
```

## Getting Output

Retrieve the last N lines of output from any terminal:

```bash
# Get last 50 lines (default)
terminal-output webserver

# Get last 100 lines
terminal-output webserver --lines 100
```

## Interrupting Commands

Send Ctrl+C to interrupt a running process:

```bash
terminal-interrupt webserver
```

## Managing Terminals

```bash
# List all active terminal panes
panes

# Close a specific terminal
close webserver
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `shell` | string | `$SHELL` or `/bin/bash` | Shell to use |
| `cwd` | string | `$HOME` | Initial working directory |
| `env` | object | - | Additional environment variables |
| `maxBufferLines` | number | 10000 | Max lines to keep in output buffer |
| `streamingEnabled` | boolean | false | Stream output to Claude in real-time |
| `title` | string | terminal ID | Display title |

## Scenarios

### interactive (default)
- User and Claude can both send commands
- Full keyboard input support
- Close with Escape key

### display
- Claude controls, user watches
- Streaming enabled by default
- Close via IPC command only

## IPC Messages

### Controller to Terminal

| Message | Description |
|---------|-------------|
| `executeCommand` | Run a command in the shell |
| `getOutput` | Request last N lines from buffer |
| `interrupt` | Send SIGINT (Ctrl+C) |
| `setStreaming` | Enable/disable live output streaming |
| `terminalInput` | Send raw input |
| `close` | Close the terminal |

### Terminal to Controller

| Message | Description |
|---------|-------------|
| `terminalReady` | Terminal initialized with shell info |
| `output` | Streaming output chunk (if enabled) |
| `outputBuffer` | Response to getOutput request |
| `commandStarted` | Command execution began |
| `commandComplete` | Command finished with exit code |
| `error` | Error occurred |

## Example Workflow

```bash
# 1. Start a web server with a named pane
spawn terminal --id server --name "backend" --config '{"cwd": "/project"}'
terminal-exec server "npm run dev"

# 2. Open another terminal for testing with its own name
spawn terminal --id tests --name "tests" --config '{"cwd": "/project"}'

# 3. Check server output
terminal-output server --lines 20

# 4. Run tests
terminal-exec tests "npm test"

# 5. Check test results
terminal-output tests --lines 50

# 6. List all terminals
panes

# 7. Stop the server
terminal-interrupt server

# 8. Clean up
close server
close tests
```

## Keyboard Shortcuts (Interactive Mode)

| Key | Action |
|-----|--------|
| `Enter` | Execute command |
| `Ctrl+C` | Interrupt running process or clear input |
| `Ctrl+L` | Clear screen |
| `Up/Down` | Navigate command history |
| `Left/Right` | Move cursor |
| `Escape` | Quit terminal |
