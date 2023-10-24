Packages:

- [@parcel/reporter-lsp](./packages/reporters/lsp-reporter/)
- [parcel-for-vscode](./packages/utils/parcelforvscode/)
- [@parcel/lsp](./packages/utils/parcel-lsp/)
- [@parcel/lsp-protocol](./packages/utils/parcel-lsp-protocol)

TODO:

- [x] need to not wait for connections
- [x] language server shuts down and kills our process when the extension is closed
- [x] handle the case where parcel is started after the extension is running
- [x] handle the case where extension is started while parcel is running
- [x] support multiple parcels
- [x] show prior diagnostics on connection
- [x] only connect to parcels that match the workspace
- [ ] show parcel diagnostic hints
- [ ] implement quick fixes (requires Parcel changes?)
- [x] cleanup LSP server sentinel when server shuts down
- [x] support multiple LSP servers (make sure a workspace only sees errors from its server)
- [x] cleanup the lsp reporter's server detection (make async, maybe use file watcher)
- [ ] make @parcel/reporter-lsp part of default config or otherwise always installed
      (or, move the reporter's behavior into core)

Ideas:

- a `parcel lsp` cli command to replace/subsume the standalone `@parcel/lsp` server
  - this could take on the complexities of decision making like automatically
    starting a Parcel build if one isn’t running, or sharing an LSP server
    for the same parcel project with multiple workspaces/instances, etc.
- integrating the behavior of `@parcel/reporter-lsp` into core
  or otherwise having the reporter be 'always on' or part of default config
