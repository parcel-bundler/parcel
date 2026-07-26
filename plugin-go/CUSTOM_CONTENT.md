# Custom content callback and memory management

Parcel may retain custom asset content after a Go transform returns. The Go SDK
therefore cannot pass Parcel a pointer to the Go `AssetContent` object directly.
Instead, it uses a `runtime/cgo.Handle`, a stable C allocation, and a small C
callback bridge.

The implementation is split between:

- [`packaging.go`](./packaging.go), which owns the Go handles and implements the callbacks.
- [`bridge.c`](./bridge.c), which passes the exported Go callbacks to the C ABI as function pointers.
- [`bridge.h`](./bridge.h), which declares the bridge functions used by cgo.

See [`examples/custom-content-transformer`](./examples/custom-content-transformer)
for a complete transformer and custom packaging implementation.

## Content results

`AssetContent.Read` and `AssetContent.Package` return the sealed `Content`
interface. The SDK provides exactly two variants:

```go
return parcel.StringContent(code), nil
```

for UTF-8 text, and:

```go
return parcel.BytesContent(data), nil
```

for arbitrary bytes. The private marker method prevents plugins from adding
unsupported variants. Go strings may contain invalid UTF-8, so the callback
validates `StringContent` before marking it as UTF-8 for Parcel.

## Ownership model

```text
Go AssetContent object
        |
        | rooted by cgo.Handle
        v
registeredContents map
        |
        | keyed by a stable C-allocated pointer
        v
Rust CContent
        |
        +-- read callback
        +-- package callback
        +-- free callback
```

The C-allocated pointer is the opaque content value retained by Parcel. The
actual Go object remains owned and managed by Go.

## Why Parcel cannot retain a Go pointer

A Go value may contain pointers managed by Go's garbage collector. C may use
some Go pointers temporarily during a cgo call, but it generally cannot retain
them after the call returns.

Passing the Go object directly would create several problems:

- Go might consider the object unreachable after `SetCustomContent` returns.
- Parcel would retain a pointer into Go-managed memory.
- The Go runtime could not track how C or Rust was using the pointer.
- The content object might itself contain additional Go pointers.

`cgo.NewHandle(content)` avoids this. It creates an integer handle registered
with the Go runtime. The handle keeps the content reachable and later recovers
it with `handle.Value()`.

## Registration

`Asset.SetCustomContent` calls `registerContent`, which:

1. Creates a `cgo.Handle` for the `AssetContent` object.
2. Allocates a small stable token with `C.malloc`.
3. Generates a 16-byte identifier for the concrete Go content type.
4. Stores the token address, handle, and type identifier in
   `registeredContents`.
5. Passes the token and callback functions to `parcel_asset_set_custom_content`.

The token is real C-owned memory, so Parcel may retain its address after the
cgo call returns. The handle, rather than the C token itself, keeps the Go
object alive.

The numeric handle is also written into the C allocation. The current callback
path performs lookup through `registeredContents`, so the allocation primarily
serves as a stable C-owned identity token.

## Why `registeredContents` is needed

`registeredContents` is a `sync.Map` keyed by the C token address. It:

- Recovers the `cgo.Handle` when Parcel invokes a callback.
- Verifies that a pointer originated from this instance of the Go SDK.
- Prevents content created by Rust or another plugin from being interpreted as
  a Go handle.
- Stores the type identifier used by `CustomContent`.
- Supports concurrent callback lookup and atomic removal during cleanup.

The `cgo.Handle` roots the Go object. The map provides provenance validation,
type validation, and lifecycle coordination.

## Why the C bridge is needed

The C ABI accepts callback function pointers:

```c
parcel_asset_set_custom_content(
    asset,
    type_id,
    content,
    read_callback,
    package_callback,
    free_callback);
```

Go exports the callback implementations with `//export`, but cgo does not
provide a convenient way for Go code to take an exported Go function's address
and pass it as a C function-pointer argument.

`bridge.c` performs that small piece of C interop. It passes these exported Go
symbols into the ABI:

- `parcel_go_content_read`
- `parcel_go_content_package`
- `parcel_go_content_free`

The bridge does not own the content. It only connects the ABI's callback slots
to the exported Go functions.

The bridge is kept in a separate `.c` file because files containing `//export`
directives must keep their cgo preambles declaration-only. Defining the bridge
functions in that preamble could cause cgo to emit duplicate definitions.

## Callback lifecycle

The complete lifecycle is:

```text
SetCustomContent
    -> create cgo.Handle
    -> allocate C token
    -> register token and handle
    -> Parcel retains token and callbacks
    -> Parcel invokes Read or Package
    -> Go resolves token back to AssetContent
    -> Parcel drops or replaces the content
    -> free callback deletes handle and frees token
```

### Read

When Parcel needs a byte or UTF-8 representation, it calls
`parcel_go_content_read`. The callback:

1. Looks up the token in `registeredContents`.
2. Recovers the original `AssetContent` through the handle.
3. Calls `AssetContent.Read`.
4. Copies the returned data into a Parcel-owned `Buffer`.

### Package

When Parcel packages the content, it calls `parcel_go_content_package`. The
callback recovers the content in the same way, creates callback-scoped
`BundleGraph`, `Bundle`, and `Options` wrappers, and calls:

```go
content.Package(bundleGraph, bundle, options)
```

The graph, bundle, assets, dependencies, and targets obtained through these
wrappers are borrowed views. They must not be retained after `Package` returns.

### Buffer ownership

The callback may temporarily pass a pointer to a Go byte slice to
`parcel_buffer_write` or `parcel_buffer_write_utf8`. This is safe because those
functions copy the data synchronously. Parcel does not retain the Go slice
pointer.

The resulting `Buffer` allocation is owned by Parcel and is reconstructed and
released by the Rust ABI after the callback returns.

### Free

Rust stores the callbacks and token in its `CContent` value. When the last
reference to that value is dropped, Rust invokes `parcel_go_content_free`.

The free callback:

1. Atomically removes the token from `registeredContents`.
2. Calls `handle.Delete()`, allowing Go to collect the content object.
3. Calls `C.free()` on the C token.

Removal and cleanup happen only when the token was still registered, which
also protects against accidental duplicate free callbacks.

## Custom-content lookup

`Asset.CustomContent` and `AssetRef.CustomContent` ask the ABI for the stored
type identifier and opaque content pointer. The Go SDK returns the content only
if:

- The pointer exists in `registeredContents`.
- The identifier returned by Parcel matches the registered Go type identifier.

Callers can then use a Go type assertion:

```go
content, ok := asset.CustomContent()
if ok {
    ast, ok := content.(*MyAST)
    // Use ast only while the containing asset is alive.
}
```

Content created by a Rust plugin or a different Go shared library is not
returned as Go content because its pointer is not present in this registry.

## Concurrency

Parcel may package bundles concurrently. `registeredContents` is therefore a
`sync.Map`, and lookup/removal are concurrency-safe. Implementations of
`AssetContent` must also be safe for any concurrent `Read` or `Package` calls
they may receive.

## Important invariants

- Never give Parcel a retained pointer to Go-managed content.
- Never convert an unverified foreign content pointer into a `cgo.Handle`.
- Keep the handle alive until Parcel invokes the free callback.
- Copy callback output into Parcel-owned buffers before returning to C.
- Do not retain package-scoped graph, bundle, asset, dependency, target, or
  options wrappers after the callback returns.
- Release both the `cgo.Handle` and C allocation exactly once.
