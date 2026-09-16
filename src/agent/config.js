const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  port: 8787,
  autoStartService: true,
  startMinimized: false,
  startWithWindows: false,
  workspaces: [],
  limits: {
    maxFileBytes: 256 * 1024,
    maxListEntries: 1000,
    maxSearchResults: 100,
    maxSearchBytes: 256 * 1024,
    commandTimeoutMs: 120000
  }
});

function mergeConfig(value = {}) {
  return {
    ...DEFAULTS,
    ...value,
    workspaces: Array.isArray(value.workspaces) ? value.workspaces : [],
    limits: { ...DEFAULTS.limits, ...(value.limits || {}) }
  };
}

function loadConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return mergeConfig();
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return mergeConfig(parsed);
}

function saveConfig(configPath, config) {
  const next = mergeConfig(config);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temp = `${configPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, configPath);
  return next;
}

module.exports = { DEFAULTS, loadConfig, saveConfig, mergeConfig };
