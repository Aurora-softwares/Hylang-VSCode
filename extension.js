const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HYDROGEN_SELECTOR = [{ language: 'hydrogen', scheme: 'file' }, { language: 'hyproj', scheme: 'file' }];
let diagnosticCollection;
let timers = new Map();
let output;

function activate(context) {
  output = vscode.window.createOutputChannel('Hydrogen');
  diagnosticCollection = vscode.languages.createDiagnosticCollection('hydrogen');
  context.subscriptions.push(output, diagnosticCollection);

  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(HYDROGEN_SELECTOR, {
    provideDocumentFormattingEdits(document) {
      return formatDocument(document);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('hydrogen.checkCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isHydrogenDocument(editor.document)) return;
    await updateDiagnostics(editor.document, true);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('hydrogen.formatCurrentFile', async () => {
    await vscode.commands.executeCommand('editor.action.formatDocument');
  }));

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleDiagnostics));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => scheduleDiagnostics(e.document)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => updateDiagnostics(doc, false)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri)));

  vscode.workspace.textDocuments.forEach(scheduleDiagnostics);
}

function deactivate() {
  for (const timer of timers.values()) clearTimeout(timer);
}

function isHydrogenDocument(document) {
  return document && (document.languageId === 'hydrogen' || document.languageId === 'hyproj');
}

function config() {
  return vscode.workspace.getConfiguration('hydrogen');
}

function scheduleDiagnostics(document) {
  if (!isHydrogenDocument(document)) return;
  const delay = Math.max(100, config().get('diagnostics.debounceMs', 500));
  const key = document.uri.toString();
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => updateDiagnostics(document, false), delay));
}

async function updateDiagnostics(document, userRequested) {
  if (!isHydrogenDocument(document)) return;
  const diagnostics = [];

  if (config().get('enableStructuralDiagnostics', true)) {
    diagnostics.push(...getStructuralDiagnostics(document));
  }

  if (config().get('enableCompilerDiagnostics', true) && document.uri.scheme === 'file') {
    try {
      diagnostics.push(...await getCompilerDiagnostics(document));
    } catch (err) {
      if (userRequested) {
        vscode.window.showWarningMessage(`Hydrogen compiler diagnostics could not run: ${err.message}`);
      }
      output.appendLine(`[diagnostics] ${err.message}`);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
  if (userRequested) vscode.window.showInformationMessage(`Hydrogen check complete: ${diagnostics.length} issue(s).`);
}

function getStructuralDiagnostics(document) {
  const text = document.getText();
  const diagnostics = [];
  const stack = [];
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stringStart = null;
  let blockCommentStart = null;
  let escaped = false;

  const pairs = { '{': '}', '[': ']', '(': ')' };
  const closers = { '}': '{', ']': '[', ')': '(' };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    const pos = document.positionAt(i);

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; stringStart = null; continue; }
      if (ch === '\n') {
        diagnostics.push(new vscode.Diagnostic(
          rangeAt(document, stringStart.index, i),
          'String is missing a closing quote before the end of the line.',
          vscode.DiagnosticSeverity.Error
        ));
        inString = false;
        stringStart = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; blockCommentStart = { index: i, pos }; i++; continue; }
    if (ch === '"') { inString = true; stringStart = { index: i, pos }; continue; }

    if (pairs[ch]) {
      stack.push({ ch, index: i, pos });
    } else if (closers[ch]) {
      const expectedOpen = closers[ch];
      const last = stack.pop();
      if (!last || last.ch !== expectedOpen) {
        diagnostics.push(new vscode.Diagnostic(
          new vscode.Range(pos, pos.translate(0, 1)),
          `Unexpected closing '${ch}'.`,
          vscode.DiagnosticSeverity.Error
        ));
        if (last) stack.push(last);
      }
    }
  }

  if (inString && stringStart) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(stringStart.pos, document.positionAt(text.length)),
      'String is missing a closing quote.',
      vscode.DiagnosticSeverity.Error
    ));
  }

  if (inBlockComment && blockCommentStart) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(blockCommentStart.pos, document.positionAt(text.length)),
      'Block comment is missing closing */.',
      vscode.DiagnosticSeverity.Error
    ));
  }

  for (const item of stack) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(item.pos, item.pos.translate(0, 1)),
      `Missing closing '${pairs[item.ch]}' for '${item.ch}'.`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  if (document.languageId === 'hydrogen') {
    diagnostics.push(...getHydrogenStyleDiagnostics(document));
  }

  return diagnostics;
}

function getHydrogenStyleDiagnostics(document) {
  const diagnostics = [];
  const lines = document.getText().split(/\r?\n/);
  let seenNamespace = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = line.replace(/\/\/.*$/, '').trim();
    if (/^namespace\b/.test(clean)) seenNamespace = true;
    if (seenNamespace && /^using\b/.test(clean)) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(i, line.indexOf('using')), new vscode.Position(i, line.length)),
        '`using` directives should appear before the namespace declaration.',
        vscode.DiagnosticSeverity.Warning
      ));
    }
  }
  return diagnostics;
}

function rangeAt(document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(Math.max(start + 1, end)));
}

async function getCompilerDiagnostics(document) {
  const hyPath = config().get('hyPath', 'hy');
  const configuredTarget = config().get('checkTarget', '').trim();
  const target = configuredTarget || document.uri.fsPath;
  const cwd = getWorkspaceFolder(document) || path.dirname(document.uri.fsPath);
  const result = await execFile(hyPath, ['check', target, '--json'], { cwd, timeout: 15000 });

  const raw = (result.stdout || '').trim();
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('`hy check --json` did not return valid JSON. See Hydrogen output for details.');
  }

  const items = Array.isArray(parsed) ? parsed : (parsed.diagnostics || parsed.items || []);
  return items
    .filter(item => !item.file || path.resolve(cwd, item.file) === document.uri.fsPath || path.resolve(item.file) === document.uri.fsPath)
    .map(item => diagnosticFromHyItem(document, item));
}

function diagnosticFromHyItem(document, item) {
  const line = Math.max(0, Number(item.line || item.startLine || 1) - 1);
  const col = Math.max(0, Number(item.column || item.startColumn || 1) - 1);
  const endLine = Math.max(line, Number(item.endLine || item.line || line + 1) - 1);
  const endCol = Math.max(col + 1, Number(item.endColumn || item.column || col + 2) - 1);
  const severity = severityFromString(item.severity);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(new vscode.Position(line, col), new vscode.Position(endLine, endCol)),
    item.message || 'Hydrogen compiler diagnostic',
    severity
  );
  diagnostic.source = 'hy check';
  if (item.code) diagnostic.code = item.code;
  return diagnostic;
}

function severityFromString(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('error')) return vscode.DiagnosticSeverity.Error;
  if (text.includes('warn')) return vscode.DiagnosticSeverity.Warning;
  if (text.includes('info')) return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Warning;
}

async function formatDocument(document) {
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  if (config().get('formatter.useHyFmt', true) && document.uri.scheme === 'file') {
    try {
      const formatted = await formatWithHyFmt(document);
      if (formatted && formatted !== document.getText()) return [vscode.TextEdit.replace(fullRange, formatted)];
    } catch (err) {
      output.appendLine(`[format] ${err.message}`);
    }
  }
  const fallback = fallbackFormat(document.getText());
  return fallback === document.getText() ? [] : [vscode.TextEdit.replace(fullRange, fallback)];
}

async function formatWithHyFmt(document) {
  const hyPath = config().get('hyPath', 'hy');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrogen-vscode-'));
  const tmpFile = path.join(tmpDir, path.basename(document.uri.fsPath || `scratch.${document.languageId === 'hyproj' ? 'hyproj' : 'hy'}`));
  try {
    fs.writeFileSync(tmpFile, document.getText(), 'utf8');
    await execFile(hyPath, ['fmt', tmpFile], { cwd: getWorkspaceFolder(document) || tmpDir, timeout: 15000 });
    return fs.readFileSync(tmpFile, 'utf8');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function fallbackFormat(text) {
  const lines = text.split(/\r?\n/);
  let indent = 0;
  const out = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) { out.push(''); continue; }
    if (/^[}\])]/.test(trimmed)) indent = Math.max(0, indent - 1);
    out.push('    '.repeat(indent) + trimmed);
    const openCount = countSyntax(trimmed, /[\{\[\(]/g);
    const closeCount = countSyntax(trimmed, /[\}\]\)]/g);
    indent = Math.max(0, indent + openCount - closeCount);
  }
  return out.join('\n');
}

function countSyntax(line, regex) {
  const stripped = line.replace(/"(?:\\.|[^"\\])*"/g, '').replace(/\/\/.*$/, '');
  const matches = stripped.match(regex);
  return matches ? matches.length : 0;
}

function getWorkspaceFolder(document) {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return folder ? folder.uri.fsPath : undefined;
}

function execFile(command, args, options) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { ...options, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (stderr) output.appendLine(stderr.trim());
      if (error) {
        if (error.code === 'ENOENT') reject(new Error(`Could not find Hydrogen CLI at '${command}'. Set hydrogen.hyPath in VS Code settings.`));
        else reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = { activate, deactivate };
