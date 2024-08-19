Packages:

- [@atlaspack/reporter-lsp](./packages/reporters/lsp-reporter/)
- [atlaspack-for-vscode](./packages/utils/atlaspackforvscode/)
- [@atlaspack/lsp](./packages/utils/atlaspack-lsp/)
- [@atlaspack/lsp-protocol](./packages/utils/atlaspack-lsp-protocol)

TODO:

- [x] need to not wait for connections
- [x] language server shuts down and kills our process when the extension is closed
- [x] handle the case where atlaspack is started after the extension is running
- [x] handle the case where extension is started while atlaspack is running
- [x] support multiple atlaspacks
- [x] show prior diagnostics on connection
- [x] only connect to atlaspacks that match the workspace
- [ ] show atlaspack diagnostic hints
- [ ] implement quick fixes (requires Atlaspack changes?)
- [x] cleanup LSP server sentinel when server shuts down
- [x] support multiple LSP servers (make sure a workspace only sees errors from its server)
- [x] cleanup the lsp reporter's server detection (make async, maybe use file watcher)
- [ ] make @atlaspack/reporter-lsp part of default config or otherwise always installed
      (or, move the reporter's behavior into core)

Ideas:

- a `atlaspack lsp` cli command to replace/subsume the standalone `@atlaspack/lsp` server
  - this could take on the complexities of decision making like automatically
    starting a Atlaspack build if one isn’t running, or sharing an LSP server
    for the same atlaspack project with multiple workspaces/instances, etc.
- integrating the behavior of `@atlaspack/reporter-lsp` into core
  or otherwise having the reporter be 'always on' or part of default config
