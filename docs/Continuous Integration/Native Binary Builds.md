# Parcel • Continuous Integration • Native Binary Builds

Parcel relies on a few native artifacts that need to be built for multiple target platforms and architectures.

To support this, there are a number of different runner jobs running on different images/os:

- macos-latest is used for arm / x86 builds of the macOS targets
- windows-latest is used for windows builds
- linux builds
  - Debian bookworm is used for x86 builds
  - Ubuntu 20.04 is used for armhf 32-bit, arm64
  - What looks like Alpine linux in napi-rs/napi-rs/nodejs-rust is used for MUSL x86 64-bit and MUSL arm64

## Testing builds locally

We can use `act` to test CI jobs locally:

- [Install the GitHub CLI](https://cli.github.com/)
- [Install `act` - `gh extension install https://github.com/nektos/gh-act`](https://nektosact.com/installation/gh.html)

Run the desired GitHub actions job:

```
gh act --input profile=release --job "build-linux-gnu-x64"
```
