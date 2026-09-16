const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveWorkspacePath, isSensitivePath } = require('./security');

function listFiles(config, params = {}) {
  const depth = Math.max(0, Math.min(Number(params.depth ?? 2), 8));
  const includeHidden = Boolean(params.include_hidden);
  const maxEntries = Math.min(Number(params.max_entries || config.limits.maxListEntries), config.limits.maxListEntries);
  const target = resolveWorkspacePath(config, params.path || '.', { workspaceRoot: params.workspace_root });
  const entries = [];

  function walk(current, currentDepth) {
    if (entries.length >= maxEntries) return;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      if (entries.length >= maxEntries) break;
      if (!includeHidden && dirent.name.startsWith('.')) continue;
      const absolute = path.join(current, dirent.name);
      const relative = path.relative(target.root, absolute);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      const type = dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : dirent.isSymbolicLink() ? 'symlink' : 'other';
      entries.push({ path: relative, type, size: stat.size });
      if (dirent.isDirectory() && currentDepth < depth) walk(absolute, currentDepth + 1);
    }
  }

  const stat = fs.statSync(target.absolutePath);
  if (stat.isDirectory()) walk(target.absolutePath, 0);
  else entries.push({ path: target.relativePath, type: 'file', size: stat.size });
  return { root: target.relativePath, entries, truncated: entries.length >= maxEntries };
}

function readFile(config, params = {}) {
  const target = resolveWorkspacePath(config, params.path, { workspaceRoot: params.workspace_root });
  const stat = fs.statSync(target.absolutePath);
  if (!stat.isFile()) throw Object.assign(new Error('Path is not a file.'), { code: 'NOT_A_FILE' });
  if (stat.size > config.limits.maxFileBytes) throw Object.assign(new Error('File exceeds configured read limit.'), { code: 'FILE_TOO_LARGE' });
  const buffer = fs.readFileSync(target.absolutePath);
  if (buffer.includes(0)) throw Object.assign(new Error('Binary files are not returned by read_file.'), { code: 'BINARY_FILE_DENIED' });
  const lines = buffer.toString(params.encoding || 'utf8').split(/\r?\n/);
  const start = Math.max(1, Number(params.start_line || 1));
  const end = Math.min(lines.length, Number(params.end_line || lines.length));
  return {
    path: target.relativePath,
    content: lines.slice(start - 1, end).join('\n'),
    start_line: start,
    end_line: end,
    total_lines: lines.length,
    truncated: end < lines.length
  };
}

function fallbackSearch(root, query, maxResults, maxBytes) {
  const results = [];
  let bytes = 0;
  const needle = query.toLowerCase();
  function walk(dir) {
    if (results.length >= maxResults || bytes >= maxBytes) return;
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= maxResults || bytes >= maxBytes) return;
      if (dirent.name.startsWith('.') || dirent.name === 'node_modules') continue;
      const absolute = path.join(dir, dirent.name);
      if (isSensitivePath(absolute)) continue;
      if (dirent.isDirectory()) { walk(absolute); continue; }
      if (!dirent.isFile()) continue;
      const stat = fs.statSync(absolute);
      if (stat.size > 1024 * 1024) continue;
      const buffer = fs.readFileSync(absolute);
      if (buffer.includes(0)) continue;
      const lines = buffer.toString('utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length >= maxResults || bytes >= maxBytes) return;
        if (line.toLowerCase().includes(needle)) {
          const item = { path: path.relative(root, absolute), line: index + 1, text: line.slice(0, 1000) };
          bytes += Buffer.byteLength(JSON.stringify(item));
          results.push(item);
        }
      });
    }
  }
  walk(root);
  return { results, truncated: results.length >= maxResults || bytes >= maxBytes, engine: 'js-fallback' };
}

function searchFiles(config, params = {}) {
  const query = String(params.query || '').trim();
  if (!query) throw Object.assign(new Error('query is required.'), { code: 'INVALID_REQUEST' });
  const base = resolveWorkspacePath(config, params.path || '.', { workspaceRoot: params.workspace_root });
  const maxResults = Math.min(Number(params.max_results || config.limits.maxSearchResults), config.limits.maxSearchResults);
  const maxBytes = config.limits.maxSearchBytes;

  return new Promise((resolve) => {
    const args = ['--line-number', '--no-heading', '--color', 'never', '--hidden', '--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!**/.env*', '--glob', '!**/*.pem', '--glob', '!**/*.key', '--glob', '!**/*secret*', '--glob', '!**/*password*', '--max-count', String(maxResults), '--', query, base.absolutePath];
    const child = spawn('rg', args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { if (Buffer.byteLength(stdout) < maxBytes) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (Buffer.byteLength(stderr) < 65536) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') return resolve(fallbackSearch(base.absolutePath, query, maxResults, maxBytes));
      resolve({ results: [], truncated: false, engine: 'rg', error: error.message });
    });
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) return resolve({ results: [], truncated: false, engine: 'rg', error: stderr.trim() || `rg exited with ${code}` });
      const results = stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults).map((line) => {
        const match = line.match(/^(.*?):(\d+):(.*)$/);
        if (!match) return { text: line };
        return { path: path.relative(base.root, match[1]), line: Number(match[2]), text: match[3].slice(0, 1000) };
      });
      resolve({ results, truncated: results.length >= maxResults || Buffer.byteLength(stdout) >= maxBytes, engine: 'rg' });
    });
  });
}

function validateCommand(config, params) {
  const command = String(params.command || '').toLowerCase();
  const args = Array.isArray(params.args) ? params.args.map(String) : [];
  const category = params.category || 'read_only';
  if (!['read_only', 'test'].includes(category)) {
    throw Object.assign(new Error('Build/write commands require an explicit future confirmation flow and are disabled in this MVP.'), { code: 'CONFIRMATION_REQUIRED' });
  }

  if (command === 'node' && args[0] === '--check' && args.length === 2) return { command: 'node', args, pathIndexes: [1] };
  if ((command === 'python' || command === 'py') && args[0] === '-m' && args[1] === 'py_compile' && args.length >= 3) return { command, args, pathIndexes: args.map((_, i) => i).filter((i) => i >= 2) };
  if (command === 'npm' && ((args.length === 1 && args[0] === 'test') || (args.length === 2 && args[0] === 'run' && args[1] === 'test'))) return { command: 'npm', args, pathIndexes: [] };
  throw Object.assign(new Error('Command is not on the validation allowlist.'), { code: 'COMMAND_DENIED' });
}

function runCommand(config, params = {}) {
  const workspace = resolveWorkspacePath(config, params.cwd || '.', { workspaceRoot: params.workspace_root });
  const validated = validateCommand(config, params);
  for (const index of validated.pathIndexes) {
    const checked = resolveWorkspacePath(config, validated.args[index], { workspaceRoot: workspace.root });
    validated.args[index] = checked.absolutePath;
  }
  const timeoutMs = Math.min(Number(params.timeout_ms || config.limits.commandTimeoutMs), config.limits.commandTimeoutMs);

  return new Promise((resolve) => {
    const child = spawn(validated.command, validated.args, { cwd: workspace.absolutePath, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (Buffer.byteLength(stdout) < 256 * 1024) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (Buffer.byteLength(stderr) < 256 * 1024) stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ exit_code: null, error: error.message, stdout, stderr }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exit_code: code, signal, stdout, stderr }); });
  });
}

async function executeTool(config, method, params) {
  switch (method) {
    case 'list_files': return listFiles(config, params);
    case 'read_file': return readFile(config, params);
    case 'search_files': return searchFiles(config, params);
    case 'run_command': return runCommand(config, params);
    default: throw Object.assign(new Error(`Unknown tool: ${method}`), { code: 'UNKNOWN_TOOL' });
  }
}

module.exports = { executeTool, listFiles, readFile, searchFiles, runCommand };
