# Parcel

This extension shows errors, warnings and other diagnostics inline in VS Code.

## Usage

1. Install this extension
2. In your project, install `@parcel/reporter-lsp` and run Parcel with that reporter, e.g. `parcel src/index.html --reporter @parcel/reporter-lsp`.

## Development Debugging

1. Go to the Run and Debug menu in VSCode
2. Select "Launch Parcel for VSCode Extension"
3. Specify in which project to run the Extension Development Host in `launch.json`:

```
{
  "version": "0.2.0",
  "configurations": [
    {
      "args": [
        "${workspaceFolder}/packages/examples/kitchen-sink", // Change this project
        "--extensionDevelopmentPath=${workspaceFolder}/packages/utils/parcelforvscode"
      ],
      "name": "Launch Parcel for VSCode Extension",
      "outFiles": [
        "${workspaceFolder}/packages/utils/parcelforvscode/out/**/*.js"
      ],
      "preLaunchTask": "Watch VSCode Extension",
      "request": "launch",
      "type": "extensionHost"
    }
  ]
}
```

4. Run a Parcel command (e.g. `parcel server --reporter @parcel/reporter-lsp`) in the Extension Host window.
5. Diagnostics should appear in the Extension Host window in the Problems panel (Shift + CMD + m).
6. Output from the extension should be available in the Output panel (Shift + CMD + u) in the launching window.

## Packaging

1. Copy [parcel-lsp](../parcel-lsp/) into the [extension directory](./).
2. Run `yarn package`. The output is a `.vsix` file.
3. Run `code --install-extension parcel-for-vscode-<version>.vsix`
