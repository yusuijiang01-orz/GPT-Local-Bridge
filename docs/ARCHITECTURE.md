# Architecture

## Process boundaries

```text
ChatGPT Custom App
        │ MCP via OpenAI-hosted tunnel
OpenAI Secure MCP Tunnel
        │ outbound long-poll / response
Official tunnel-client child process
        │ Streamable HTTP
MCP Bridge child process (127.0.0.1 only)
        │ token-auth localhost RPC
Local Agent child process (127.0.0.1 only)
        │
Workspace filesystem / allowlisted validation commands / audit JSONL

Electron renderer (no Node integration)
        │ contextBridge / IPC
Electron main process
        ├─ owns Local Agent lifecycle
        ├─ owns MCP Bridge lifecycle
        ├─ optionally owns tunnel-client lifecycle
        └─ captures runtime logs and health state
```

The renderer never receives the Local Agent bearer token, Tunnel Runtime API Key, or direct Node APIs. The Electron main process owns lifecycle, configuration and the random Local Agent session token.

## Local Agent

- Listens on `127.0.0.1` only.
- Every HTTP endpoint requires a per-Electron-session random bearer token.
- Paths are canonicalized through `realpath` and must remain inside a configured workspace.
- Sensitive path patterns (`.env`, keys, secrets, browser storage names) are denied by default.
- `run_command` uses `spawn(..., { shell: false })` and a narrow validation allowlist.
- Build/write categories remain blocked; they are not silently executed.
- Audit records store request ID, tool, success/failure, error code and duration, not file contents.

## MCP Bridge

The MCP Bridge binds to `127.0.0.1` and exposes `/mcp` using the MCP TypeScript SDK's Streamable HTTP transport.

It registers the same bounded capabilities as MCP Tools:

- `list_files`
- `read_file`
- `search_files`
- `run_command`

MCP clients never receive the Local Agent bearer token. The MCP Bridge obtains it from its process environment, then translates each MCP tool call into the authenticated Local Agent RPC protocol.

The current transport uses MCP sessions and JSON responses. A local `/health` endpoint exists only for Electron supervision.

## Secure MCP Tunnel

ChatGPT cannot directly reach localhost. When configured, Electron launches the official OpenAI `tunnel-client` with:

- the configured `tunnel_id`;
- `CONTROL_PLANE_API_KEY` referenced through the environment;
- the local MCP URL (`http://127.0.0.1:<mcpPort>/mcp`);
- a loopback health listener.

The Runtime API Key is intentionally not stored in `config.json`. Electron only exposes a boolean indicating whether the environment variable exists.

The Tunnel's `/readyz` endpoint is used as a local readiness signal. “Tunnel ready” does not itself prove that a user has selected the matching Custom App in ChatGPT.

## Runtime logging

Electron captures stdout/stderr from all child processes into an in-memory ring buffer and `userData/runtime.log`.

Sources are tagged as:

- `APP`
- `AGENT`
- `MCP`
- `TUNNEL`

Before logs are persisted or sent to the renderer, the main process masks:

- Bearer-token looking strings;
- the current Local Agent session token;
- common `sk-...` API key shapes.

This runtime log is separate from the Local Agent's `audit.jsonl`.

## Service lifecycle

- Normal launch: show control panel unless `startMinimized` is enabled.
- `--silent`: create tray and configured bridge stack without showing the window.
- `--stop`: if another instance is active, request that instance to stop the bridge stack.
- Windows login: when packaged, `startWithWindows` registers the app with `--silent`.
- Stop stack order: Tunnel → MCP Bridge → Local Agent.
- Child processes receive `SIGTERM`; a process-tree kill fallback is used if they do not exit.
- Closing the window hides it to the tray; choosing **Exit** stops the stack first.

## Configuration boundaries

Persisted configuration may contain:

- local ports;
- workspace roots;
- Tunnel ID;
- tunnel-client executable path;
- startup preferences;
- output/timeout limits.

Persisted configuration must not contain:

- OpenAI Runtime API Key;
- Local Agent bearer token;
- browser cookies or sessions;
- workspace file contents.

## Validation

CI runs on Windows and Linux:

1. `npm install`
2. `npm run check`
3. `npm run test:smoke`

The smoke test launches a temporary Local Agent and MCP Bridge, performs MCP `initialize`, `tools/list`, and a real `list_files` tool call, then terminates both processes.

## Future write support

A later milestone can add structured patching and build execution only after the following are implemented:

- explicit confirmation tokens;
- request idempotency;
- workspace mutexes;
- before/after hashes and change summaries;
- non-retrying destructive failures;
- post-write re-read and validation.
