# LSP Reporter

This reporter is for sending diagnostics to a running [LSP server](../../utils/atlaspack-lsp/). This is inteded to be used alongside the Atlaspack VS Code extension.

It creates an IPC server for responding to requests for diagnostics from the LSP server, and pushes diagnostics to the LSP server.

## Usage

This reporter is run with Atlaspack build, watch, and serve commands by passing `@atlaspack/reporter-lsp` to the `--reporter` option.

```sh
atlaspack serve --reporter @atlaspack/reporter-lsp
```
