# parcel-resolver

parcel-resolver implements the Node.js module resolution algorithm.
It supports both CommonJS and ES module resolution, along with many
additional features supported by various tools in the JavaScript ecosystem,
such as TypeScript's tsconfig paths and extension rewriting, the "alias"
and "browser" fields used by bundlers, absolute and tilde paths, and more.
These can be individually turned on or off using feature flags.

For a full description of all supported resolution features, see [Parcel's documentation](https://parceljs.org/features/dependency-resolution/).

# Example

Create a [Resolver] using one of the constructors. For example, `Resolver::node`
creates a Node.js compatible CommonJS resolver, `Resolver::node_esm` creates an ESM resolver,
and `Resolver::parcel` creates a Parcel-compatible resolver. From there you can customize individual
features such as extensions or index files by setting properties on the resolver.

Finally, call `resolver.resolve` to resolve a specifier, reading through the given file system.
Files consulted during resolution are tracked by the file system (e.g. a `TrackingFileSystem`)
rather than returned by the resolver.

```rust
use parcel_resolver::{Resolver, SpecifierType, ResolutionAndQuery, OsFileSystem, PathId};
use std::path::Path;

let resolver = Resolver::node_esm(PathId::new(Path::new("/path/to/project-root")));
let fs = OsFileSystem::default();

let res = resolver.resolve(
  "lodash",
  PathId::new(Path::new("/path/to/project-root/index.js")),
  SpecifierType::Esm,
  &fs,
);

if let Ok(ResolutionAndQuery { resolution, query }) = res {
  // Do something with the resolution!
}
```
