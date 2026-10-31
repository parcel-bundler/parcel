# Parcel plugin SDK for Swift

Write native Parcel transformers, resolvers, namers, optimizers, and reporters in
Swift. Plugins are dynamic libraries that Parcel loads through its C plugin ABI,
just like plugins built with the Rust (`crates/parcel-plugin`) and Go
(`plugin-go`) SDKs.

Requires Swift 6.2.3 or later, for `@nonexhaustive` enums (SE-0487), and macOS 15
or later at runtime. Parcel may add cases to the SDK's enums, such as
`ResolveResult` and `DependencyResolution`, so a `switch` over one needs an
`@unknown default`.

## A plugin

```swift
// Package.swift
let package = Package(
  name: "TxtTransformer",
  platforms: [.macOS(.v15)],
  products: [.library(name: "TxtTransformer", type: .dynamic, targets: ["TxtTransformer"])],
  dependencies: [.package(url: "https://github.com/parcel-bundler/parcel", branch: "v3")],
  targets: [
    .target(
      name: "TxtTransformer",
      dependencies: [.product(name: "ParcelPlugin", package: "parcel")])
  ]
)
```

```swift
// Sources/TxtTransformer/TxtTransformer.swift
import ParcelPlugin

struct TxtTransformer: Transformer {
  struct Config: Decodable {
    var prefix: String?
  }

  let prefix: String

  init(config: Config) {
    prefix = config.prefix ?? ""
  }

  func transform(_ asset: Asset, options: Options) async throws {
    // javaScriptString escapes a string literal; see Examples/Sources/TxtTransformer.
    asset.setContent("export default \(javaScriptString(prefix + (try asset.content())));")
    asset.type = "js"
  }
}

#parcelPlugin(TxtTransformer.self)
```

Then build it with `swift build -c release`, and add `.build/release/libTxtTransformer.dylib` to a
`.parcelrc`:

```json
{
  "extends": "@parcel/config-default",
  "transformers": { "*.txt": ["./libTxtTransformer.dylib"] }
}
```

A plugin conforms to one or more of `Transformer`, `Resolver`, `Namer`,
`Optimizer`, and `Reporter`. Its `Config` is decoded from the plugin's options in
the `.parcelrc` with `JSONDecoder`. A plugin without options declares
`init(config: NoConfig)`. `#parcelPlugin` exports the type, and must appear
exactly once in a library.

The [examples](Examples/Sources) cover every kind of plugin, as well as custom
asset content and async code. Parcel's integration tests build them all; see
`crates/parcel-plugin/tests/swift_plugins.rs`.

## Concurrency

Every plugin method is `async`, but Parcel calls plugins synchronously, from many
threads at once. The SDK runs each call as a task whose work runs on the thread
Parcel called in on, and that thread works through the task's jobs until the
task finishes. As a result:

- **Plugins are `Sendable`.** One instance serves every thread. Keep shared
  mutable state in an actor, or behind a `Mutex`.
- **`await` works as usual.** When you await an actor, I/O, or a `@concurrent`
  function, that work runs elsewhere, and the call then resumes on Parcel's
  thread.
- **Child tasks run on Parcel's thread too, one at a time.** Parcel already runs
  one call per core, so that's usually what you want. To run CPU-bound work in
  parallel, add it to a task group with
  `addTask(executorPreference: globalConcurrentExecutor)`.
- **Never wait on the main actor.** Parcel's main thread doesn't run Swift's main
  executor, so `@MainActor` code never runs, and the call hangs forever. Don't
  set `defaultIsolation(MainActor.self)` on a plugin target.

## Handles

`Asset`, `Options`, `Dependency`, `BundleGraph`, `OutputBundle`, and the other
handles are valid only for the duration of the call they were passed to. Using
one after the call returns traps, with a message naming the handle.

Binary content can come from any byte container: `asset.setContent(data)`
takes `[UInt8]`, `Data`, or any other `DataProtocol`, and passes contiguous
storage to Parcel without copying it.

`Asset` is not `Sendable`, so the compiler keeps it inside the transform call's
own task. The SDK also checks at runtime that it is only used on that call's
thread. The read-only handles are `Sendable`, so they can be read from several
tasks at once.

## Errors

Throw a `Diagnostic` to fail a call with a code frame and a hint. Any other
`Error` is reported with its description. To warn without failing, use
`options.log(.warning("..."))`.

Swift can't recover from a trap the way Rust and Go recover from a panic. A failed
force unwrap, an out-of-bounds index, or `fatalError` aborts Parcel itself, so
throw instead.

## Custom content

`asset.setCustomContent(_:)` stores a Swift value of your own (an `AssetContent`)
on an asset in place of its content. Parcel calls the value's `read()` and
`package(_:in:options:)` later, from any thread, so it must be `Sendable`. See
the [CustomContentTransformer example](Examples/Sources/CustomContentTransformer).

Each content type declares a `contentTypeID`, e.g.
`static let contentTypeID = ContentTypeID("UppercaseContent")`. Parcel groups
assets by it to package them and hashes it into bundle ids, so keep it the same
across builds. It is namespaced by your module, so other plugins can use the
same name.

## Publishing

A native plugin is published as a metadata package, plus one package per
platform holding the library. The reusable
[`native-plugin` workflow](../.github/workflows/native-plugin.yml) builds and
publishes Swift plugins in the same way as Rust and Go ones, for macOS (arm64 and
x86_64) and Linux glibc (x64 and arm64). See
[its README](../.github/scripts/native-plugin/README.md#swift) for details.
While developing, point `parcel.devLibrary` at the build output instead, e.g.
`./.build/debug/libMyPlugin`.

Set `engines.parcel` in your package.json to the Parcel versions your plugin was
built for: at least the version whose source the SDK came from. The SDK carries
that Parcel's `plugin.h`, and a plugin built against it needs a Parcel that
implements every host function it calls.

## Development

Work on the SDK through `plugin-swift/Package.swift`, which the examples depend
on by path. The root `Package.swift` must declare the same targets: keep the two
in sync.

`Sources/CParcelABI/include/plugin.h` is a copy of
`crates/parcel-plugin-abi/plugin.h`, which that crate's build script keeps up to
date. `swift test` runs the SDK's unit tests. The SDK keeps its own copies of the
header's constants, and the unit tests check them against the header.
