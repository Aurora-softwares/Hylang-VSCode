<div align="center">

<img src="assets/hydrogen.icon.svg" width="30%" />

# Hydrogen Language Tools for VS Code

</div>

Editor support for Hylang (also called Hydrogen). The extension recognizes `.hy` source files and `.hyproj` project manifests.

## Features

- Syntax highlighting, comments, bracket matching, and indentation for `.hy` and `.hyproj` files.
- Snippets for namespaces, classes, `Main`, loops, and console output.
- Immediate structural diagnostics for unmatched brackets, unterminated strings, and block comments.
- Compiler diagnostics from `hy check` when the `hy` executable is available. The extension checks the saved file, or a configured `.hyproj` target, and shows issues in VS Code's Problems view.
- Document formatting through `hy fmt` when using a CLI build that provides it. The released Hydrogen compiler does not currently provide `hy fmt`.

The compiler is **not bundled** in the extension. Highlighting, snippets, and structural diagnostics work without it. The extension does not currently provide completion, go to definition, or a language server client.

## Build and export a VSIX

Install [Node.js and npm](https://nodejs.org/), then run these commands from this folder (`Hylang-VSCode`):

```bash
npm ci
npm test
npm run package
```

`npm run package` creates `dist/hydrogen-language-tools.vsix`. This VSIX is the exported plugin file to share or install; it does not publish the extension to the Marketplace. The package script uses the local `@vscode/vsce` dependency, so a global `vsce` installation is unnecessary.

## Change the extension icon

The extension listing uses `assets/hylang-icon.png`, specified by the `icon` property in `package.json`. To use your own artwork, replace that PNG with a square image of at least 128 × 128 pixels (256 × 256 is recommended), then run `npm run package` again. Install the rebuilt VSIX with `code --install-extension dist/hydrogen-language-tools.vsix --force`. The SVG in `assets/hydrogen.icon.svg` is the editable source for the included icon; VS Code's extension icon must be a PNG.

To try the extension without creating a VSIX, open this folder in VS Code and press **F5** to launch an Extension Development Host, or run:

```bash
code --extensionDevelopmentPath="$PWD" /path/to/your/hydrogen/project
```

## Install the exported plugin

In VS Code, open **Extensions**, select the **...** menu, choose **Install from VSIX...**, and select `dist/hydrogen-language-tools.vsix`. Reload the VS Code window if prompted.

Or install it from a terminal:

```bash
code --install-extension dist/hydrogen-language-tools.vsix
```

To replace an already installed copy with a newly built VSIX, run:

```bash
code --install-extension dist/hydrogen-language-tools.vsix --force
```

You can also build and install in one step with `npm run install:vsix`. Once installed, open a `.hy` or `.hyproj` file and confirm that VS Code shows **Hylang** or **Hylang Project** as the language mode. VS Code's [VSIX installation guide](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix) covers the same UI and CLI installation methods.

## Connect the compiler

Install a Hylang/Hydrogen `hy` compiler separately and make it available on `PATH`, or set its absolute path in VS Code settings:

```json
{
  "hylang.hyPath": "/absolute/path/to/hy"
}
```

The extension runs `hy check` on save. Use **Hylang: Check Current File** from the Command Palette to run it manually. Compiler errors appear in **View > Problems**. For projects with multiple source files, set a project target so the compiler checks the complete project:

```json
{
  "hylang.checkTarget": "MyApp/MyApp.hyproj"
}
```

The target path is relative to the open workspace folder. You can turn automatic compiler checks off with `"hylang.enableCompilerDiagnostics": false`; the manual check command remains available. If `hy` is missing or fails without recognizable diagnostics, open **View > Output** and select **Hylang** for details.

**Formatting:** **Hylang: Format Current File** and VS Code's **Format Document** command use `hy fmt` on a temporary copy of the file, then apply the result in the editor. This requires a CLI build with `hy fmt`, such as the C++ SDK. The released self-hosted compiler supports `hy check` but not `hy fmt`; on that compiler, formatting reports that it is unavailable and leaves the document unchanged.
