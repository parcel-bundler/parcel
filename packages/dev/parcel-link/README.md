# `parcel-link`

A CLI for linking a dev version of Parcel into a project.

## Installation

Clone and run `yarn`, then `cd packages/dev/parcel-link && yarn link`
to make the `parcel-link` and `parcel-unlink` binaries globally available.

## Usage

In an Parcel project root:

```sh
$ parcel-link
```

## Cleanup

To restore the project to its default Parcel install:

```sh
$ parcel-unlink
```
