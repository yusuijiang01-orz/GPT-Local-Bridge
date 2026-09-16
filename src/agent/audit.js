const fs = require('node:fs');
const path = require('node:path');

class AuditLog {
  constructor(filePath) {
    this.filePath = filePath;
    if (filePath) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  write(event) {
    if (!this.filePath) return;
    const record = {
      timestamp: new Date().toISOString(),
      ...event
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

module.exports = { AuditLog };
