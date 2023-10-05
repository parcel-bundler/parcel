# `parcel-link`

A CLI for linking a dev version of Parcel into a project.

## Installation

Clone and run `yarn`, then `cd packages/dev/parcel-link && yarn link`
to make the `parcel-link` binary globally available.

## Usage

In an Parcel project root:

```sh
$ parcel-link [options] [packageRoot]
```

### Specifying `packageRoot`

```sh
$ parcel-link /path/to/parcel/packages
```

By default, `parcel-link` will link to packages in the same
location where `parcel-link` is found. But it is common
to want to link other worktrees of Parcel, and it's not fun
to have to first re-link `parcel-link` to a new location.

For this reason, `parcel-link` accepts a `packageRoot` argument,
which specifies a path to a Parcel `packages` directory.
Links will then be made to packages in that location instead
of the default.

### Specifying a `namespace`

```sh
$ parcel-link --namespace @my-parcel-fork
```

When linking into a project that uses a fork of Parcel,
the published packages may have a different namespace from
Parcel, so `parcel-link` allows specifying a namespace.

If defined to someting other than `"@parcel"`,
`parcel-link` will do some extra work to adjust
namespaced packages to reference linked packages instead.

### Linking into a monorepo

```sh
$ parcel-link --node-modules-globs build-tools/*/node_modules build-tools/parcel/*/node_modules
```

In a monorepo, there may be multiple locations where
Parcel packages are installed. For this, `parcel-link`
allows specifying globs of locations where packages should be linked.

Note that specifying any value here will override the default of `node_modules`,
so if you want to preserve the default behavior, be sure to include `node_modules`
in the list of globs:

```sh
$ parcel-link -g build-tools/*/node_modules -g build-tools/parcel/*/node_modules -g node_modules
```

## Cleanup

To restore the project to its default Parcel install:

```sh
$ parcel-link unlink [options] [packageRoot]
```
