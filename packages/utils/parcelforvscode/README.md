# Parcel

This extension shows errors, warnings and other diagnostics inline in VS Code.

## Usage

1. Install this extension
2. In your project, install `@parcel/reporter-lsp` and run Parcel with that reporter, e.g. `parcel src/index.html --reporter @parcel/reporter-lsp`.

## Debugging

### Logging

If logging in `LspReporter.js`, use `process.stdout.write()` as `console.log()` messages will cause an infinite loop https://parceljs.org/plugin-system/reporter/#example

If logging in `LspServer.ts`, use `console.log()`. The logs will show up in the `Output` section of vscode under the `Parcel` tab

If logging in any of the extension code (`parcelforvscode`), use `console.log()` and the logs will show up in the `Debug Console` in vscode.
