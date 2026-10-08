# Hydrogen Language Tools

<img src="assets/hydrogen.icon.svg" style="display: block;margin-left: auto; margin-right: auto; width: 30%;" />

Local VS Code support for Hydrogen / Hylang.

## Features

- Syntax highlighting for `.hy` files.
- Basic highlighting for `.hyproj` project manifests.
- Snippets for namespaces, classes, `Main`, loops, and console output.
- Document formatting:
  - Uses `hy fmt` when available.
  - Falls back to a simple brace-aware formatter when `hy` is missing.
- Diagnostics:
  - Built-in checks for missing closing `{}`, `[]`, `()`, quotes, and block comments.
  - Warning when `using` appears after a namespace declaration.
  - Optional `hy check <target> --json` diagnostics.

## Install

From the folder containing the VSIX:

```bash
code --install-extension hydrogen-language-tools-0.1.0.vsix
```

Or in VS Code:

1. Open Extensions.
2. Choose the `...` menu.
3. Select **Install from VSIX...**.
4. Pick `hydrogen-language-tools-0.1.0.vsix`.

## Recommended settings

If `hy` is not on your PATH, set the CLI path:

```json
{
  "hydrogen.hyPath": "/absolute/path/to/hy"
}
```

For multi-file projects, set the project or workspace target so diagnostics check the whole project:

```json
{
  "hydrogen.checkTarget": "path/to/YourProject.hyproj"
}
```

## Notes

This extension is intentionally local-first. It does not bundle the Hydrogen compiler. It will still provide syntax highlighting, snippets, fallback formatting, and structural diagnostics without `hy` installed.
