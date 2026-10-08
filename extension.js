const vscode = require('vscode');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCheckOutput } = require('./diagnostics');

const selector = [{ language: 'hylang', scheme: 'file' }, { language: 'hyproj', scheme: 'file' }];
const timers = new Map();
const checkRevisions = new Map();
const compilerSnapshots = new Map();
let structuralDiagnostics;
let compilerDiagnostics;
let output;
let formatWarningShown = false;

function isHylangDocument(document) {
  return document && (document.languageId === 'hylang' || document.languageId === 'hyproj');
}

function settings() {
  return vscode.workspace.getConfiguration('hylang');
}

function activate(context) {
  output = vscode.window.createOutputChannel('Hylang');
  structuralDiagnostics = vscode.languages.createDiagnosticCollection('hylang-structure');
  compilerDiagnostics = vscode.languages.createDiagnosticCollection('hylang-compiler');
  context.subscriptions.push(output, structuralDiagnostics, compilerDiagnostics);

  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
    provideDocumentFormattingEdits: formatDocument
  }));
  context.subscriptions.push(vscode.commands.registerCommand('hylang.checkCurrentFile', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!isHylangDocument(document) || document.uri.scheme !== 'file') return;
    if (document.isDirty && !await document.save()) return;
    await checkDocument(document, true);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('hylang.formatCurrentFile', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!isHylangDocument(document)) return;
    await vscode.commands.executeCommand('editor.action.formatDocument');
  }));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleStructureCheck));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => scheduleStructureCheck(event.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    scheduleStructureCheck(document);
    void checkDocument(document, false);
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
    const key = document.uri.toString();
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.delete(key);
    structuralDiagnostics.delete(document.uri);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('hylang')) {
      for (const document of vscode.workspace.textDocuments) scheduleStructureCheck(document);
      if (!settings().get('enableCompilerDiagnostics', true)) {
        compilerSnapshots.clear();
        compilerDiagnostics.clear();
      }
    }
  }));
  for (const document of vscode.workspace.textDocuments) scheduleStructureCheck(document);
}

function deactivate() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function scheduleStructureCheck(document) {
  if (!isHylangDocument(document)) return;
  const key = document.uri.toString();
  if (timers.has(key)) clearTimeout(timers.get(key));
  const delay = Math.max(100, settings().get('diagnostics.debounceMs', 300));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    if (settings().get('enableStructuralDiagnostics', true)) {
      structuralDiagnostics.set(document.uri, findStructuralIssues(document));
    } else {
      structuralDiagnostics.delete(document.uri);
    }
  }, delay));
}

function findStructuralIssues(document) {
  const source = document.getText();
  const issues = [];
  const stack = [];
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const openers = { '}': '{', ']': '[', ')': '(' };
  const manifest = document.languageId === 'hyproj';
  let state = 'code';
  let start = 0;
  let escaped = false;

  const addIssue = (from, to, message) => {
    const range = new vscode.Range(document.positionAt(from), document.positionAt(Math.max(from + 1, to)));
    issues.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error));
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line') { if (char === '\n') state = 'code'; continue; }
    if (state === 'block') { if (char === '*' && next === '/') { state = 'code'; index++; } continue; }
    if (state === 'string') {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { state = 'code'; continue; }
      if (char === '\n') { addIssue(start, index, 'String is missing a closing quote.'); state = 'code'; }
      continue;
    }
    if ((manifest && char === '#') || (!manifest && char === '/' && next === '/')) {
      state = 'line';
      if (!manifest) index++;
      continue;
    }
    if (!manifest && char === '/' && next === '*') { state = 'block'; start = index; index++; continue; }
    if (char === '"') { state = 'string'; start = index; continue; }
    if (pairs[char]) stack.push({ char, index });
    else if (openers[char]) {
      const last = stack[stack.length - 1];
      if (last?.char === openers[char]) stack.pop();
      else addIssue(index, index + 1, `Unexpected closing '${char}'.`);
    }
  }
  if (state === 'string') addIssue(start, source.length, 'String is missing a closing quote.');
  if (state === 'block') addIssue(start, source.length, 'Block comment is missing closing */.');
  for (const item of stack) addIssue(item.index, item.index + 1, `Missing closing '${pairs[item.char]}'.`);
  return issues;
}

function workspaceDirectory(document) {
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || path.dirname(document.uri.fsPath);
}

function runHy(args, cwd) {
  const command = settings().get('hyPath', 'hy').trim() || 'hy';
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') reject(new Error(`Cannot find '${command}'. Set hylang.hyPath to the hy executable.`));
      else if (error?.killed) reject(new Error('The Hylang command timed out after 15 seconds.'));
      else resolve({ exitCode: error ? error.code || 1 : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function checkDocument(document, requested) {
  if (!isHylangDocument(document) || document.uri.scheme !== 'file') return;
  if (!requested && !settings().get('enableCompilerDiagnostics', true)) return;
  const cwd = workspaceDirectory(document);
  const configuredTarget = settings().get('checkTarget', '').trim();
  const target = configuredTarget ? path.resolve(cwd, configuredTarget) : document.uri.fsPath;
  const version = document.version;
  const revision = (checkRevisions.get(target) || 0) + 1;
  checkRevisions.set(target, revision);
  try {
    const result = await runHy(['check', target], cwd);
    if (document.version !== version || checkRevisions.get(target) !== revision) return;
    const raw = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const items = parseCheckOutput(raw, document.uri.fsPath);
    const snapshot = [];
    for (const item of items) {
      const uri = vscode.Uri.file(path.resolve(cwd, item.file || document.uri.fsPath));
      const range = new vscode.Range(
        Math.max(0, item.line - 1), Math.max(0, item.column - 1),
        Math.max(0, item.line - 1), Math.max(0, item.column)
      );
      const severity = item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, item.message, severity);
      diagnostic.source = 'hy check';
      snapshot.push({ uri, diagnostic });
    }
    compilerSnapshots.set(target, snapshot);
    publishCompilerDiagnostics();
    if (result.exitCode !== 0 && items.length === 0) {
      const message = raw.trim() || `hy check exited with code ${result.exitCode}.`;
      output.appendLine(`[check] ${message}`);
      if (requested) vscode.window.showWarningMessage(`Hylang check failed. See the Hylang output channel: ${message.split('\n')[0]}`);
    } else if (requested) {
      vscode.window.showInformationMessage(`Hylang check complete: ${items.length} issue(s).`);
    }
  } catch (error) {
    output.appendLine(`[check] ${error.message}`);
    if (requested) vscode.window.showWarningMessage(error.message);
  }
}

function publishCompilerDiagnostics() {
  const grouped = new Map();
  for (const snapshot of compilerSnapshots.values()) {
    for (const { uri, diagnostic } of snapshot) {
      const key = uri.toString();
      if (!grouped.has(key)) grouped.set(key, { uri, diagnostics: [] });
      grouped.get(key).diagnostics.push(diagnostic);
    }
  }
  compilerDiagnostics.clear();
  for (const group of grouped.values()) compilerDiagnostics.set(group.uri, group.diagnostics);
}

function warnFormat(message) {
  output.appendLine(`[format] ${message}`);
  if (!formatWarningShown) {
    formatWarningShown = true;
    vscode.window.showWarningMessage(message);
  }
}

async function formatDocument(document) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hylang-vscode-'));
  const filename = path.join(directory, `document.${document.languageId === 'hyproj' ? 'hyproj' : 'hy'}`);
  try {
    fs.writeFileSync(filename, document.getText(), 'utf8');
    const result = await runHy(['fmt', filename], workspaceDirectory(document));
    if (result.exitCode !== 0) {
      const detail = [result.stderr, result.stdout].find(text => text.trim())?.trim() || 'hy fmt failed.';
      warnFormat(`Formatting requires a Hylang CLI with hy fmt support. ${detail}`);
      return [];
    }
    const formatted = fs.readFileSync(filename, 'utf8');
    if (formatted === document.getText()) return [];
    return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), formatted)];
  } catch (error) {
    warnFormat(error.message);
    return [];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { activate, deactivate };
