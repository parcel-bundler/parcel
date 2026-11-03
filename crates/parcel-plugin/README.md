# parcel-plugin

Rust SDK for building native [Parcel](https://parceljs.org) plugins: transformers, resolvers,
namers, optimizers and reporters.

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
parcel-plugin = "0.1"
serde_json = "1" # used by the example below
```

## A plugin

A plugin is a type implementing the `Plugin` trait, registered once at the crate root with
`register_plugin!`. Parcel calls the method for the role the `.parcelrc` gives the plugin, so
implement only the ones you need: `transform`, `resolve`, `name` or `optimize`. A reporter
implements any of `build_start`, `build_success`, `build_failure` and `log`.

```rust
use parcel_plugin::{Asset, Diagnostic, Options, Plugin, register_plugin};

struct TxtTransformer;

impl Plugin for TxtTransformer {
  // Called for each .parcelrc entry naming the plugin, with that entry's config as JSON.
  fn new(_config: &[u8]) -> Result<Self, Diagnostic> {
    Ok(TxtTransformer)
  }

  fn transform(&self, asset: &mut Asset, _options: &Options) -> Result<(), Diagnostic> {
    // A JSON string is a JavaScript string literal.
    let literal =
      serde_json::to_string(&asset.content()?).map_err(|e| Diagnostic::new(e.to_string()))?;
    asset.set_content(format!("export default {literal};\n"));
    asset.set_type("js");
    Ok(())
  }
}

register_plugin!(TxtTransformer);
```

More are in
[plugin-rs/examples](https://github.com/parcel-bundler/parcel/tree/v3/plugin-rs/examples), one per
kind of plugin.

## Building and loading it

```sh
cargo build
```

Then give the plugin a package.json declaring the plugin ABI it was built for, and the library to
load while you develop it:

```json
{
  "name": "parcel-transformer-txt",
  "engines": { "parcel": "^3.0.0-0" },
  "parcel": {
    "abi": 1,
    "devLibrary": "./target/debug/libparcel_transformer_txt"
  }
}
```

Parcel appends this platform's extension to `devLibrary` (`.dylib`, `.so` or `.dll`). Cargo names
the library after the crate, with a `lib` prefix everywhere but Windows. A `.parcelrc` can then
name the plugin by its package name, as users will:

```json
{
  "extends": "@parcel/config-default",
  "transformers": { "*.txt": ["parcel-transformer-txt"] }
}
```

To publish, build for every platform with the reusable workflow described in
[.github/scripts/native-plugin](https://github.com/parcel-bundler/parcel/blob/v3/.github/scripts/native-plugin/README.md),
which also publishes a package per platform and removes `devLibrary`.

## Things to know

- **Threads.** Parcel calls one plugin from many threads at once: transforms and resolves run in
  parallel, as do optimizers. That is why `Plugin` requires `Send + Sync` and every method takes
  `&self`. Keep state that changes behind a `Mutex` or atomics.
- **Lifetimes.** Everything a method receives, such as `Asset`, `Options` and `BundleGraph`, is
  borrowed from Parcel for the duration of the call. The borrow checker stops you keeping one, but
  not a raw pointer into one.
- **Errors.** Return a `Diagnostic` to fail a call, with a code frame, a hint or a documentation
  link attached through its builder methods. It also converts from a `String` or `&str`. A failed
  call into Parcel, such as `Asset::content`, returns a `Diagnostic` carrying Parcel's own
  diagnostics, which `?` reports unchanged. Reporter methods cannot fail the build: their errors
  are reported and the build carries on.
- **Panics.** Panics are caught and reported as diagnostics, but only if they unwind. Don't build
  the plugin with `panic = "abort"`, or a panic will take down the whole Parcel process.
- **Custom content.** A transformer can keep its own data on an asset until it is packaged, such as
  a parsed AST, by implementing `AssetContent` and calling `Asset::set_custom_content`. See the
  [custom content example](https://github.com/parcel-bundler/parcel/tree/v3/plugin-rs/examples/custom-content-transformer).
- **Versions.** `register_plugin!` checks at load time that Parcel implements the plugin ABI this
  SDK was built against. Parcel may be older than the SDK and lack host functions added since: the
  SDK checks for each one when it is called, so a plugin needs a newer Parcel only if it uses one,
  and otherwise fails with a diagnostic saying so.

## License

MIT
