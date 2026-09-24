# Tessera

A desktop app for running a team of Claude Code sessions on one folder: an orchestrator for the folder
itself, and an agent for each subfolder.

Built with Electron, xterm.js (WebGL renderer) and node-pty. node-pty ships N-API prebuilds, so
`npm install` needs no C++ toolchain.

## Run

Needs Node 20+ and the `claude` CLI on your PATH.

```sh
npm install
npm start      # build the page and open the app
npm test       # unit tests (node:test)
```

## Use

- **Open folder**. The orchestrator, a Claude session in the folder itself, opens in the sidebar on the
  right. Click the folder name to switch to a recent folder.
- **Open subfolder** starts an agent (a Claude session) in one subfolder. **Open all subfolders** starts
  one in each (hidden folders and `node_modules` are skipped). Each agent is a live tile.
- **Click a tile** to zoom in: a file tree on the left, the agent in the middle. Rest the pointer on the
  right edge and a terminal in that folder slides in. It stays loaded while the view is open and is
  closed with it. Clicking a file in the tree adds `@path` to the agent's prompt (right-click: Open).
  Close with × in the top right.
- Tessera saves each folder's orchestrator and agents. Next launch it reopens the last folder, and every
  session resumes its own conversation.
- Drag the sidebar's left edge to resize it. Day / night switch in the top right.

Shortcuts (Cmd instead of Ctrl on macOS):

| Keys | |
|---|---|
| Ctrl+1 … 9 | zoom into agent N |
| Ctrl+Shift+W | close the zoomed view |
| Ctrl+` | show / hide the terminal in the zoomed view |
| Ctrl+Shift+O | open folder |
| Ctrl+Shift+L | day / night |
| Ctrl+= / Ctrl+- / Ctrl+0 | font size |

In a terminal, Ctrl+C copies when text is selected and interrupts otherwise. Ctrl+V pastes, and
Shift+Enter adds a new line to Claude's prompt. Drop files onto a terminal to paste their paths.

## The orchestrator

The orchestrator is told about the `tessera` command, which every session has on its PATH. Ask it
something like:

> Have the kaggriculture agent run the arena for v5, wait for it, and summarize the result.

It uses:

```
tessera list                      the orchestrator and agents, with state (working / idle / exited)
tessera send <pane> <text>        type text into a session and press Enter ("-" reads stdin)
tessera wait <pane>               wait until the session has been quiet for a few seconds
tessera read <pane> [--lines N]   last lines of the session's screen
tessera open [folder]             start an agent (default: this folder)
```

The command talks to the app over a named pipe (a user-only socket on macOS/Linux) with a random
token. Both exist only for processes started inside Tessera. To leave the orchestrator's prompt hint
out, set `claude.orchestration` to `false`.

## Configuration

Everything machine-specific lives in `config.local.json`, which git ignores. Running from source, it
sits next to `package.json`. `TESSERA_CONFIG=/some/path.json` overrides the location. The app keeps the
open folder, recent folders, saved sessions, theme and window position there. `shell.command` picks
the terminal in the zoomed view (default: pwsh or PowerShell on Windows, `$SHELL` elsewhere). You can also edit it by hand
while the app runs. See [`config.example.json`](config.example.json) for the settings.

If the file stops parsing, Tessera keeps running on the last good settings and saves nothing until the
file is fixed. It shows the line and column of the error.

## Remote jobs strip

A strip at the bottom shows jobs on a remote machine. It stays hidden until `jobs.host` and
`jobs.command` are set:

```json
"jobs": { "host": "your-ssh-alias", "command": "python3 ~/jobs_status.py", "intervalSeconds": 30 }
```

- `host` is an alias from `~/.ssh/config` (HostName, User and IdentityFile go there, not here).
- ssh runs with `BatchMode=yes`, so it never prompts: it needs a key or an agent. Tessera never
  stores passwords or keys.
- The command prints one job per line, as JSON `{"name", "state", "detail", "progress"}` or as
  `name<TAB>state<TAB>detail`. The state can be running, queued, done or failed.
- [`scripts/remote/jobs_status.py`](scripts/remote/jobs_status.py) is a starting point. It reports tmux
  sessions and `~/.jobs/*.json` status files.

Polling pauses while the window is minimized and backs off after failures.

## Layout of the code

```
src/main/       Electron main process: window, config, ptys, ssh poller, control channel
src/preload/    the narrow API the page may call
src/renderer/   the page: agent tiles, zoomed view, file tree, orchestrator sidebar
src/cli/        the `tessera` command
bin/            PATH wrappers for the command (sh and cmd)
```
