/**
 * The Rust target triples a Parcel native plugin can be published for.
 *
 * Keys are the values used in the `parcel.artifacts` map of a plugin's
 * package.json. Each entry says how to build the target and how to describe it
 * to npm:
 *
 *   runner  - the GitHub Actions runner label the build runs on.
 *   builder - `native` uses cargo directly, `zig` uses cargo-zigbuild.
 *   glibc   - minimum glibc version, appended to the triple for cargo-zigbuild.
 *   os/cpu  - Node.js `process.platform` / `process.arch` names, used for the
 *             npm `os` and `cpu` fields.
 *   libc    - npm `libc` field. Only meaningful on linux.
 *   ext     - extension of the cdylib cargo produces for this target.
 */
export const TARGETS = {
  'aarch64-apple-darwin': {
    runner: 'macos-latest',
    builder: 'native',
    os: 'darwin',
    cpu: 'arm64',
    ext: 'dylib',
  },
  'x86_64-apple-darwin': {
    runner: 'macos-latest',
    builder: 'native',
    os: 'darwin',
    cpu: 'x64',
    ext: 'dylib',
  },
  'aarch64-pc-windows-msvc': {
    runner: 'windows-latest',
    builder: 'native',
    os: 'win32',
    cpu: 'arm64',
    ext: 'dll',
  },
  'x86_64-pc-windows-msvc': {
    runner: 'windows-latest',
    builder: 'native',
    os: 'win32',
    cpu: 'x64',
    ext: 'dll',
  },
  'i686-pc-windows-msvc': {
    runner: 'windows-latest',
    builder: 'native',
    os: 'win32',
    cpu: 'ia32',
    ext: 'dll',
  },
  'x86_64-unknown-linux-gnu': {
    runner: 'ubuntu-latest',
    builder: 'zig',
    glibc: '2.26',
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    ext: 'so',
  },
  'aarch64-unknown-linux-gnu': {
    runner: 'ubuntu-latest',
    builder: 'zig',
    glibc: '2.26',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    ext: 'so',
  },
  'armv7-unknown-linux-gnueabihf': {
    runner: 'ubuntu-latest',
    builder: 'zig',
    glibc: '2.26',
    os: 'linux',
    cpu: 'arm',
    libc: 'glibc',
    ext: 'so',
  },
  'x86_64-unknown-linux-musl': {
    runner: 'ubuntu-latest',
    builder: 'zig',
    os: 'linux',
    cpu: 'x64',
    libc: 'musl',
    ext: 'so',
  },
  'aarch64-unknown-linux-musl': {
    runner: 'ubuntu-latest',
    builder: 'zig',
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
    ext: 'so',
  },
};

/**
 * The target passed to `cargo zigbuild --target`. Zig encodes the minimum
 * glibc version in the triple itself, which is how we get a binary that runs on
 * distros older than the build runner.
 */
export function zigTarget(target) {
  let info = TARGETS[target];
  return info.glibc ? `${target}.${info.glibc}` : target;
}
