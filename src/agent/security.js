const fs = require('node:fs');
const path = require('node:path');

const SENSITIVE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /password/i,
  /secret/i,
  /^cookies?(?:\.|$)/i,
  /local storage/i,
  /session storage/i
];

function isSubPath(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isSensitivePath(candidate) {
  return candidate.split(path.sep).some((segment) => SENSITIVE_PATTERNS.some((re) => re.test(segment)));
}

function getWorkspaceRoots(config) {
  const roots = [];
  for (const item of config.workspaces || []) {
    if (typeof item !== 'string' || !item.trim()) continue;
    try {
      roots.push(fs.realpathSync.native(path.resolve(item)));
    } catch {
      // Missing/inaccessible roots are ignored until the user fixes configuration.
    }
  }
  return [...new Set(roots)];
}

function resolveWorkspacePath(config, requestedPath = '.', options = {}) {
  const roots = getWorkspaceRoots(config);
  if (!roots.length) {
    const error = new Error('No valid workspace is configured.');
    error.code = 'NO_WORKSPACE';
    throw error;
  }

  const explicitRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
  let selectedRoot = roots[0];
  if (explicitRoot) {
    const normalized = fs.realpathSync.native(explicitRoot);
    if (!roots.includes(normalized)) {
      const error = new Error('Requested workspace is not allowed.');
      error.code = 'WORKSPACE_DENIED';
      throw error;
    }
    selectedRoot = normalized;
  }

  const combined = path.resolve(selectedRoot, requestedPath || '.');
  let real;
  try {
    real = fs.realpathSync.native(combined);
  } catch {
    const error = new Error('Path does not exist or is inaccessible.');
    error.code = 'PATH_NOT_FOUND';
    throw error;
  }

  if (!isSubPath(real, selectedRoot)) {
    const error = new Error('Path escapes the configured workspace.');
    error.code = 'WORKSPACE_DENIED';
    throw error;
  }
  if (!options.allowSensitive && isSensitivePath(real)) {
    const error = new Error('Sensitive path is blocked by policy.');
    error.code = 'SENSITIVE_PATH_DENIED';
    throw error;
  }

  return { root: selectedRoot, absolutePath: real, relativePath: path.relative(selectedRoot, real) || '.' };
}

module.exports = { resolveWorkspacePath, getWorkspaceRoots, isSensitivePath };
