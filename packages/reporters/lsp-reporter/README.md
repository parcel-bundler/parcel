# LSP Reporter

This reporter is for sending diagnostics to a running [LSP server](../../utils/parcel-lsp/). This is inteded to be used alongside the Parcel VS Code extension.

It creates an IPC server for responding to requests for diagnostics from the LSP server, and pushes diagnostics to the LSP server.

## Usage

This reporter is run with Parcel build, watch, and serve commands by passing `@parcel/reporter-lsp` to the `--reporter` option.

```sh
parcel serve --reporter @parcel/reporter-lsp
```
