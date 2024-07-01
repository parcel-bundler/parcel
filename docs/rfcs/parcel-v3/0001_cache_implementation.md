# Parcel v3 - RFC - Cache implementation

- **Status** - _Discussing_
- **Last updated** - 01-06-2024

## Current state

Currently, parcel caches data to abstract caches. Many different types of entries are stored, and there are multiple
cache back-end implementations.

In practice, for production builds, only LMDB and File back-ends are used. LMDB is used for most cache entries, but the
LMDB cache back-end will also write certain entries with the File back-end, depending on their size.

This should be considered tech-debt as it breaks certain guarantees we get from using an embedded database library in
the first place.

### Cache back-ends

#### File-system cache back-end

The file-system cache works by creating a 2 level deep base64 encoded key hash tree, which is used for storing entries.
For the file-system cache, all keys are base64 encoded hashes. Keys that aren’t base64 encoded will fail silently to
write, which is a defect in the current implementation.

If a base64 encoded key hash is `aabcdefg`, the entry will be written into `aa/bcdefg`.

```
aa
| bcdefg
```

#### LMDB cache back-end

The LMDB cache is managed by a native library. It consists of two files, a data.mdb and a lock file. LMDB does not
implement compression internally, but the `“LMDB-js”` package consumed in parcel implements a lot of extra logic in its
[native C++ add-on including per-entry compression (src/compression.cpp#L50)](https://github.com/kriszyp/lmdb-js/blob/master/src/compression.cpp#L50).

Each entry’s contents are compressed individually with lz4.

The LMDB cache wraps around a file-system cache to support “large blob entries”. The “large blob” entries are not
compressed.

#### Serialisation format

Entries are stored as binary blobs of the `v8.serialize` output. This is using
the [“V8 Serialization API”](https://nodejs.org/api/v8.html#serialization-api).

For a special “large blob entry”, the cache does not consider the serialisation format and simply stores a string/buffer
into a file entry directly. These entries also do not get base64 encoded or stored hierarchically and are written
directly under their file names.

V8 serialized buffers have a downside in that they store the keys of each objects within the format. This means a lot of
the time most of the size of each serialized buffer will be duplicated key names. Running gzip compression over the
large blob entries shows a 7x size reduction; this validates the assumption that most of the size comes from key names.

While per entry compression may be applied, if data is spread amongst multiple entries compression is ineffective to
address this inefficiency.

#### Large blob entries

For all back-ends, some entries are stored directly as files. For these entries, the file paths are not hashed, and
simply contain the cache-key directly.

```
/.parcel-cache/large-blob-key-1
/.parcel-cache/large-blob-key-2
/.parcel-cache/data.mdb
/.parcel-cache/...
...
```

Furthermore, these entries contain a mechanism to shard files in 2GB blobs. The idea is writing a “large-blob” entry
may shard contents into multiple files. The sharding is done at a byte level, meaning each shard is just a 2GB section
of the bytes in some giant V8 serialized buffer.

This should be considered as technical debt and removed.

#### Cache entry contents

The reason why there are different ad-hoc means of storing entries, is as an optimisation to the problem that the cache
is storing a few very large cache entries, as opposed to many smaller ones. The following structures are each stored in
a single cache entry, which can be gigabytes in size:

- AssetGraph - Graph + Nodes
- BundleGraph - Graph + Nodes
- RequestTracker - Graph + Nodes

These are objects representing all “requests” parcel ran, all the file transformation outputs, and lot of bundle
metadata for all produced bundles.

These structures are essentially unbounded depending on the size of the project. The writing on a large mono-repository
takes multiple seconds and failures will often lead to database corruption in production due to the ad-hoc nature of
this cache implementation.

#### Request tracker nodes sharding

In addition to the mechanisms already listed, there is another mechanism implementing sharding of the request tracker
nodes storage. Since the requests structure is very large, storage of nodes is sharded.

That is, request nodes are split into groups of a several thousand and stored on many “large blob” files, each around
1.2MB in size. Other data is stored on an adjacent key in LMDB that contains the graph edges and other information.

This ad-hoc writing is not fully transactional and may lead to cache corruption.

On a large project, for both “large blobs” and “incremental write” sharding, quitting the process at any point in an up
to 30 seconds window on a fast computer may corrupt the cache.

Some ad-hoc protections are in place trying to prevent the process from exiting in this case, but they are not totally
effective in production.

Integrity of the cache must be guaranteed in other ways; since the process may be terminated, the machine may shutdown
etc. Such guarantees would be provided out-of-the-box by LMDB, but the usage within `parcel` prevents their
effectiveness.

## Design principles of a revised approach

We can simplify caching with the following principle:

- Only one cache back-end is used; LMDB is fine, but the LMDB.js library is written in C++ and I can reproduce segfaults
  in it when testing
- All entries are binary encoded
- Each request result is stored on its own cache entry
- All writes are manually batched with a transaction. Each write will complete in a small fraction of a millisecond
  (1ns) and if we rely on in-memory caching (cache: true), the write will be instantaneous as we don’t need to wait.
  This should make any overhead from splitting cached requests onto multiple entries be zero, while improving the
  reliability of the cache significantly.

### Cache invalidations

Currently, cache invalidations are done in a few different ways:

- The cache key contains a hash of inputs to certain operation
- The cache entry is manually deleted on invalidation
- The request tracker is used to invalidate cache entries, and does so by maintaining a graph of dependant requests and
  file-system events that should trigger them to re-run

In order to simplify some of this invalidation logic, we can use read/write tracking of file-system access, object
access and cache access.

That is, we will implement 2 types of caches:

- Request cache
- Function cache

For function caches, caching will be automatically done by caching function outputs and storing them using the inputs
hash as the cache key. This cache will be LRU and bounded; meaning that there'll be no invalidation of cache entries,
only a bound to its maximum size.

For request caches, caching will be done only in the request tracker and never accessed anywhere else.

This cache will use the "request ID" as its entry (where the request ID should be a hash of the request inputs).

Furthermore, for all requests, we will use a "tracking filesystem" or "tracking configuration reader" implementation.
That is, when a request `Request::run` method is called, we will construct a `TrackingFileSystem` struct to pass onto
it.

The request may access the file-system, and we will track all access. We will then store the request result and its
invalidation in the request tracker.

### Graph structure on entries

For request tracker node entries, the following structure will be used:

- `request::${id}` - Stores the state of the request
- `request::${id}` - Stores the state of the request
- `request::${id}::result` - Stores the output of the request
- `request::${id}::edges` - Stores the array of outgoing edges from this request onto other sub-requests ; thanks to
  LMDB transactions it'll be possible to append atomically to this list

We may also collect lists of related request nodes:

- `request_tracker::${id}` - Stores the state of a request tracker
- `request_tracker::${id}::requests` - Stores the list of request IDs related to this request tracker

## Relation with the JavaScript request tracker persistence

We will segment the caches between the current JavaScript implementation and the new Rust implementation.

For all Rust back-ed requests, we will disable caching and allow Rust to manage reading from its own cache
implementation.

## Serialization format

We will research and benchmark a few options for serialization, then aim to make a decision trading-off serialization
performance, stability and size.

## Large blob entries

We will deprecate hybrid file-system and LMDB caches. All entries will be written to LMDB.

## Remote caches

We should consider that at some point the cache contents may be segmented between a local and a remote cache. That is,
a cache server URL might be provided and the bundler should be able to fetch from it if a cache entry is missing
locally.

## LMDB wrapper library

Suggest we use:

- https://github.com/meilisearch/heed

Which seems mature enough due to usage in `meilisearch`.

### LMDB tuning

We should flip the following [LMDB flags](http://www.lmdb.tech/doc/group__mdb__env.html#ga5791dd1adb09123f82dd1f331209e12e):

- `NOSYNC` - Do not call [`fsync`](https://man7.org/linux/man-pages/man2/fsync.2.html) after commit. This means
  potentially our cache won't be durable (if the system shuts-down before the OS is able to flush data, it could be
  there would be data loss, even after writing), but we don't care about durability for our use-case.
- `MAPASYNC` - Do not call [`msync`](https://man7.org/linux/man-pages/man2/msync.2.html) after writing. This is
  the same effect.
- `NOMETASYNC` - Do not `fsync` the metapage after commit

This greatly improves write performance.

### LMDB and RKYV

Unfortunately `rkyv` and LMDB can't be used together. You can see a failing test case reproduction on commit
`d75dda3af93179c58a4b55fdcc42a6a60e7f3e2f`. RKYV code was available on the `lmdb-cache-implementation` branch until
being removed on commit `71e7fc269881a44bab0d44b054e53ce8beabc477`.

`rkyv` requires values to be aligned by 4-byte words - https://rkyv.org/architecture/alignment.html. Since LMDB has no
alignment guarantee on values, in order to use `rkyv` we'd be forced to copy the LMDB buffers onto an aligned location.

This breaks the point of using zero-copy serialization, since in order to use `rkyv` with LMDB we'll need to copy the
buffers into aligned memory locations or to try to get LMDB to align its internal structures.

The issue is discussed on https://github.com/AltSysrq/lmdb-zero/issues/8 and https://github.com/meilisearch/heed/issues/198.

### Orders of magnitude for LMDB write performance from rust

This has been tested on an EC2 `c7i.8xlarge` instance using criterion.

- Serializing a single request - **165ns** with `bincode` and 288ns with `rkyv`
- Read a single request and deserialize - **821ns**
- Write 1 request with async writes - **15204ns** / **15us**
- Write 1 request with sync writes - **3000000ns** / **3000us** / **3ms**
- Write 1000 request with async/sync writes - **14080000ns** / **14000us** / **14ms**

These are just ballpark numbers. Using these numbers we can estimate that the cache throughput will be between
hundreds of thousands of requests a second to a million requests a second. We can likely optimise things further.

Serialization itself is relatively fast here, and the issue is waiting on the disk write. This could be performed in
the background.

### Request IDs and throughput

LMDB stores entries on a B-tree following sorted lexicographically. We can improve read/write throughput significantly
by putting related entries on close entries. That is, for two requests with keys `request::${id}`, if they will be
written and read one after another then the ideal `id`s are consecutive lexicographical strings like `a` and `b` or
`1` and `2`.

When using sync writes, this improves the performance of writing 1000 entries in a single transaction by 10x, making
it perform comparable to async writes.

## Serialization performance

### bincode

The current `bincode` `encode_to_vec` implementation looks as follows:

```
/// Encode the given value into a `Vec<u8>` with the given `Config`. See the [config] module for more information.
///
/// [config]: config/index.html
#[cfg_attr(docsrs, doc(cfg(feature = "alloc")))]
pub fn encode_to_vec<E: enc::Encode, C: Config>(val: E, config: C) -> Result<Vec<u8>, EncodeError> {
    let size = {
        let mut size_writer = enc::EncoderImpl::<_, C>::new(SizeWriter::default(), config);
        val.encode(&mut size_writer)?;
        size_writer.into_writer().bytes_written
    };
    let writer = VecWriter::with_capacity(size);
    let mut encoder = enc::EncoderImpl::<_, C>::new(writer, config);
    val.encode(&mut encoder)?;
    Ok(encoder.into_writer().inner)
}
```

Since this encodes values twice it's significantly slower than encoding into a slice writer. There may be some times
when this will out-perform the slice writer, but not on a synthetic benchmark.
