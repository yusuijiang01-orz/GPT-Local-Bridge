# Architecture

## Process boundaries

```text
Electron renderer (no Node integration)
        │ contextBridge / IPC
Electron main process
        │ authenticated localhost HTTP
Local Agent child process (127.0.0.1 only)
        │
Workspace filesystem / allowlisted validation commands / audit JSONL
```

The renderer never receives the Local Agent bearer token and cannot access Node APIs directly. The main process owns service lifecycle, configuration and the random session token.

## Service lifecycle

- Normal launch: show control panel unless `startMinimized` is enabled.
- `--silent`: create tray + service without showing the window.
- Windows login: when packaged, `startWithWindows` registers the app with `--silent`.
- Stop service: graceful `SIGTERM`, then process-tree termination fallback.
- Closing the window hides it to the tray; choosing **Exit** stops the service first.

## Local Agent security model

- Listens on `127.0.0.1` only.
- Every endpoint requires a per-session random bearer token.
- Paths are canonicalized through `realpath` and must remain inside a configured workspace.
- Sensitive path patterns (`.env`, keys, secrets, browser storage names) are denied by default.
- `run_command` uses `spawn(..., { shell: false })` and a narrow validation allowlist.
- Build/write categories return `CONFIRMATION_REQUIRED` in the MVP; they are not silently executed.
- Audit records store request ID, tool, success/failure, error code and duration, not file contents.

## Implemented RPC tools

- `list_files`
- `read_file`
- `search_files` (`rg`, with a bounded JavaScript fallback)
- `run_command` for validation-only commands (`node --check`, `python -m py_compile`, `npm test`)

A later milestone can add structured patching and build execution with explicit confirmation tokens, idempotency keys and workspace mutexes.
