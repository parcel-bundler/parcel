# Building and publishing native Parcel plugins

`parcel-bundler/parcel/.github/workflows/native-plugin.yml` is a reusable GitHub Actions
workflow that builds a Rust Parcel plugin for every platform it declares, and publishes
the results to npm.

A native plugin is published as one package per platform, plus a plugin package that
depends on all of them as `optionalDependencies`. npm installs only the artifact package
matching the host's `os`, `cpu`, and `libc`, so users download one binary instead of
seven. The workflow derives all of that from a single `parcel` key in your package.json.

## Your package.json

```json
{
  "name": "@devongovett/parcel-transformer-ts-doc",
  "description": "Parcel v3 transformer for typescript documentation",
  "version": "1.0.0",
  "license": "MIT",
  "repository": "https://github.com/devongovett/ts-doc-rs",
  "parcel": {
    "abi": 1,
    "artifacts": {
      "aarch64-apple-darwin": "@devongovett/parcel-transformer-ts-doc-darwin-arm64",
      "x86_64-apple-darwin": "@devongovett/parcel-transformer-ts-doc-darwin-x64",
      "x86_64-pc-windows-msvc": "@devongovett/parcel-transformer-ts-doc-win32-x64-msvc",
      "x86_64-unknown-linux-gnu": "@devongovett/parcel-transformer-ts-doc-linux-x64-gnu",
      "aarch64-unknown-linux-gnu": "@devongovett/parcel-transformer-ts-doc-linux-arm64-gnu",
      "x86_64-unknown-linux-musl": "@devongovett/parcel-transformer-ts-doc-linux-x64-musl",
      "aarch64-unknown-linux-musl": "@devongovett/parcel-transformer-ts-doc-linux-arm64-musl"
    }
  }
}
```

- `parcel.abi` — the Parcel plugin ABI version your crate builds against.
- `parcel.artifacts` — one entry per platform you want to ship, mapping a Rust target
  triple to the npm package name its binary is published under. The build matrix is
  these keys; add or remove a line to add or drop a platform.

Your `Cargo.toml` must build a `cdylib`:

```toml
[lib]
crate-type = ["cdylib"]
```

## Using the workflow

```yaml
name: release

on:
  push:
    tags: ['v*']

jobs:
  release:
    permissions:
      contents: read
      id-token: write # required for npm trusted publishing
    uses: parcel-bundler/parcel/.github/workflows/native-plugin.yml@v2
    with:
      path: .
      publish: true
```

To use it as a build check on pull requests, call it the same way with `publish: false`
(the default). Everything except the publish step runs, and the tarballs are uploaded as
workflow artifacts so you can download and inspect exactly what would have been
published.

### Inputs

| Input            | Default  | Description                                                        |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `path`           | `.`      | Directory containing the plugin's `package.json` and `Cargo.toml`. |
| `publish`        | `false`  | Publish to npm once every target has built successfully.           |
| `rust-toolchain` | `stable` | Rust toolchain to build with.                                      |
| `cargo-args`     | `''`     | Extra arguments for cargo, e.g. `--features foo`.                  |
| `node-version`   | `24`     | Node.js version used for packaging and publishing.                 |
| `zig-version`    | `0.14.0` | Zig version used by `cargo-zigbuild` for Linux targets.            |

### Outputs

`name` and `version` of the plugin package that was built.

## Publishing

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so
there is no npm token to create or rotate. Before your first release, configure a trusted
publisher on npmjs.com for **every** package the workflow publishes — the plugin package
and each artifact package — pointing at your repository and the workflow file that calls
this one. The calling job must also grant `id-token: write`, as above.

Artifact packages are published before the plugin package, so the plugin is never
resolvable before the binaries its `optionalDependencies` pin.

## Supported targets

| Rust target                     | Runner           | Built with     | os     | cpu   | libc  |
| ------------------------------- | ---------------- | -------------- | ------ | ----- | ----- |
| `aarch64-apple-darwin`          | `macos-latest`   | cargo          | darwin | arm64 |       |
| `x86_64-apple-darwin`           | `macos-latest`   | cargo          | darwin | x64   |       |
| `aarch64-pc-windows-msvc`       | `windows-latest` | cargo          | win32  | arm64 |       |
| `x86_64-pc-windows-msvc`        | `windows-latest` | cargo          | win32  | x64   |       |
| `i686-pc-windows-msvc`          | `windows-latest` | cargo          | win32  | ia32  |       |
| `x86_64-unknown-linux-gnu`      | `ubuntu-latest`  | cargo-zigbuild | linux  | x64   | glibc |
| `aarch64-unknown-linux-gnu`     | `ubuntu-latest`  | cargo-zigbuild | linux  | arm64 | glibc |
| `armv7-unknown-linux-gnueabihf` | `ubuntu-latest`  | cargo-zigbuild | linux  | arm   | glibc |
| `x86_64-unknown-linux-musl`     | `ubuntu-latest`  | cargo-zigbuild | linux  | x64   | musl  |
| `aarch64-unknown-linux-musl`    | `ubuntu-latest`  | cargo-zigbuild | linux  | arm64 | musl  |

Apple and Windows targets build on their native runners. Linux targets are cross compiled
with `cargo-zigbuild`; glibc targets link against glibc 2.26 so the binaries run on
distributions older than the runner image.

To add a target, add it to [`targets.mjs`](targets.mjs).

## What gets published

For each target the workflow copies the cdylib to `plugin.<ext>` and generates a
package.json from yours: same metadata, the artifact package's name, and the npm
`os`/`cpu`/`libc` fields for that platform.

```json
{
  "name": "@devongovett/parcel-transformer-ts-doc-darwin-arm64",
  "description": "Parcel v3 transformer for typescript documentation",
  "version": "1.0.0",
  "license": "MIT",
  "repository": "https://github.com/devongovett/ts-doc-rs",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "files": ["plugin.dylib"],
  "parcel": {
    "abi": 1,
    "library": "plugin.dylib"
  }
}
```

Fields that describe your wrapper package's own code — `scripts`, dependencies, `main`,
`exports`, `bin`, `private`, `workspaces`, and similar — are dropped, since an artifact
package contains nothing but the binary.

Your own package is published as-is apart from `optionalDependencies`, which the workflow
adds with an exact-version entry for each artifact package. Your checked-in package.json
is not modified: the edit is made against a temporary copy while packing.

### Keeping Rust sources out of your package

`npm pack` runs in your plugin directory, so by default it ships everything there that is
not gitignored — including `Cargo.toml`, `Cargo.lock`, and `src/`. Your package does not
need any of it: the binaries live in the artifact packages, and all your package
contributes is metadata pointing at them.

Add this to your package.json:

```json
"files": []
```

npm always includes `package.json`, `README`, and `LICENSE` no matter what `files` says,
so an empty list publishes exactly those three and nothing else. Unlike an `.npmignore`,
it stays correct as the crate grows. If you do ship something alongside the binaries —
type definitions, a JS shim — list those files instead.

Artifact packages are unaffected either way: each is staged in a temporary directory
containing only the cdylib and its generated package.json.

## Scripts

The workflow runs these directly; they are also runnable locally.

- [`matrix.mjs`](matrix.mjs) — prints the build matrix derived from `parcel.artifacts`.
- [`pack-artifact.mjs`](pack-artifact.mjs) — packs one target's cdylib into a tarball.
- [`pack-main.mjs`](pack-main.mjs) — packs the plugin package with `optionalDependencies`,
  failing if any declared target is missing a build.
- [`targets.mjs`](targets.mjs) — the supported target registry.
- [`plugin-package.mjs`](plugin-package.mjs) — package.json validation and generation.

```sh
node matrix.mjs --dir path/to/plugin
node pack-artifact.mjs --dir path/to/plugin --target aarch64-apple-darwin \
  --cargo-messages cargo.json --out ./artifacts
node pack-main.mjs --dir path/to/plugin --artifacts ./artifacts --out ./main
```

`--cargo-messages` is the JSON stream from
`cargo build --message-format json-render-diagnostics`, which is how the packing script
locates the cdylib cargo produced rather than guessing its path.
