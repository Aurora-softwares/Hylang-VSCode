const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCheckOutput } = require('../diagnostics');

test('parses released compiler diagnostics from failed checks', () => {
  assert.deepEqual(parseCheckOutput('2:7 error Unknown name\n', '/project/Program.hy'), [
    { file: '/project/Program.hy', line: 2, column: 7, severity: 'error', message: 'Unknown name' }
  ]);
});

test('parses C++ SDK errors and warnings with file paths', () => {
  assert.deepEqual(parseCheckOutput('src/Program.hy:3:5: invalid expression\nsrc/Program.hy:4:1: warning: unused value\n', '/fallback.hy'), [
    { file: 'src/Program.hy', line: 3, column: 5, severity: 'error', message: 'invalid expression' },
    { file: 'src/Program.hy', line: 4, column: 1, severity: 'warning', message: 'unused value' }
  ]);
});

test('ignores success and unrelated command output', () => {
  assert.deepEqual(parseCheckOutput('check ok\nunknown argument: --json\n', '/fallback.hy'), []);
});
