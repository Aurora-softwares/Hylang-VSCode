const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

fs.writeFileSync(path.join(dist, 'README.md'),
  `# Hydrogen Language Tools for VS Code\n\n` +
  `Documentation and installation: https://hylang.co.uk/editor/vscode/\n\n` +
  `This extension is version ${version}. The Hydrogen compiler is installed separately.\n`);
fs.writeFileSync(path.join(dist, 'CHANGELOG.md'),
  `# Changelog\n\n` +
  `Version ${version} release notes: https://hylang.co.uk/editor/changelog/\n`);
