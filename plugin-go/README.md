# Parcel plugins in Go

`github.com/parcel-bundler/parcel/plugin-go` builds native [Parcel](https://parceljs.org)
plugins in Go: transformers, resolvers, namers, optimizers and reporters, compiled to a shared
library that Parcel loads directly.

```sh
go get github.com/parcel-bundler/parcel/plugin-go@core-rs3
```

## A plugin

A plugin is any value implementing one or more of `parcel.Transformer`, `parcel.Resolver`,
`parcel.Namer`, `parcel.Optimizer` and `parcel.Reporter`, returned by the factory passed to
`parcel.RegisterPlugin`. Parcel calls the method for the role the `.parcelrc` gives the plugin.

```go
package main

import (
	"encoding/json"
	"fmt"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

type TxtTransformer struct{}

// Fails to compile if TxtTransformer stops implementing parcel.Transformer. Without it, a
// mistyped method signature only shows up when Parcel calls the plugin.
var _ parcel.Transformer = (*TxtTransformer)(nil)

func (*TxtTransformer) Transform(asset *parcel.Asset, _ *parcel.Options) error {
	content, err := asset.Content()
	if err != nil {
		return err
	}
	// A JSON string is a JavaScript string literal.
	literal, err := json.Marshal(content)
	if err != nil {
		return err
	}
	asset.SetContent(fmt.Sprintf("export default %s;\n", literal))
	asset.SetType("js")
	return nil
}

func init() {
	// Called for each .parcelrc entry naming the plugin, with that entry's config as JSON.
	parcel.RegisterPlugin(func(config []byte) (any, error) {
		return &TxtTransformer{}, nil
	})
}

// c-shared libraries need a main package, but never run its main.
func main() {}
```

More are in [examples](examples), one per kind of plugin.

## Building and loading it

Build a shared library with cgo:

```sh
go build -buildmode=c-shared -o plugin.dylib .   # .so on Linux, .dll on Windows
```

Then give the plugin a package.json declaring the plugin ABI it was built for, and the library to
load while you develop it:

```json
{
  "name": "parcel-transformer-txt",
  "engines": { "parcel": "^3.0.0-0" },
  "parcel": {
    "abi": 1,
    "devLibrary": "./plugin"
  }
}
```

Parcel appends this platform's extension to `devLibrary`, so build to `plugin.dylib`, `plugin.so`
or `plugin.dll` to match. A `.parcelrc` can then name the plugin by its package name, as users
will:

```json
{
  "extends": "@parcel/config-default",
  "transformers": { "*.txt": ["parcel-transformer-txt"] }
}
```

To publish, build for every platform with the reusable workflow described in
[.github/scripts/native-plugin](../.github/scripts/native-plugin/README.md), which also publishes a
package per platform and removes `devLibrary`.

## Things to know

- **Threads.** Parcel calls one plugin from many goroutines at once: transforms and resolves run in
  parallel, as do optimizers. Guard any state that changes with a mutex or atomics.
- **Lifetimes.** Everything a method receives, such as `*Asset`, `*Options` and `*BundleGraph`, and
  everything obtained from them, is valid only until the method returns. Never keep one, or use it
  from a goroutine that outlives the call.
- **Errors.** Return an `error` to fail a call. Return a `*parcel.Diagnostic` (directly or wrapped
  with `%w`) for a code frame, a hint, or a documentation link. An error from a call into Parcel,
  such as `Asset.Content`, carries Parcel's own diagnostics, which returning it reports unchanged.
  Panics are recovered and reported as diagnostics.
- **Text.** Strings marked as text must be valid UTF-8. A Go string can hold any bytes, so the SDK
  checks, and stores content that is not UTF-8 as bytes.
- **Custom content.** A transformer can keep its own data on an asset until it is packaged, such as
  a parsed AST: see [CUSTOM_CONTENT.md](CUSTOM_CONTENT.md).

## Testing the SDK

The package's tests use cgo helpers that are kept out of plugin builds with a build tag:

```sh
go test -tags parceltest ./...
```
