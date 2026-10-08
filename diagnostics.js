// Parse the text emitted by both the released Hydrogen compiler and the C++ SDK.
function parseCheckOutput(output, fallbackFile) {
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    let match = line.match(/^(.+):(\d+):(\d+):\s*(?:(warning|error):\s*)?(.+)$/i);
    if (match) {
      diagnostics.push({
        file: match[1], line: Number(match[2]), column: Number(match[3]),
        severity: (match[4] || 'error').toLowerCase(), message: match[5]
      });
      continue;
    }
    match = line.match(/^(\d+):(\d+)\s+(error|warning)\s+(.+)$/i);
    if (match) {
      diagnostics.push({
        file: fallbackFile, line: Number(match[1]), column: Number(match[2]),
        severity: match[3].toLowerCase(), message: match[4]
      });
    }
  }
  return diagnostics;
}

module.exports = { parseCheckOutput };
