# `atlaspack-link`

A CLI for linking a dev version of Atlaspack into a project.

## Installation

Clone and run `yarn`, then `cd packages/dev/atlaspack-link && yarn link`
to make the `atlaspack-link` binary globally available.

## Usage

In an Atlaspack project root:

```sh
$ atlaspack-link [options] [packageRoot]
```

### Specifying `packageRoot`

```sh
$ atlaspack-link /path/to/atlaspack/packages
```

By default, `atlaspack-link` will link to packages in the same
location where `atlaspack-link` is found. But it is common
to want to link other worktrees of Atlaspack, and it's not fun
to have to first re-link `atlaspack-link` to a new location.

For this reason, `atlaspack-link` accepts a `packageRoot` argument,
which specifies a path to a Atlaspack `packages` directory.
Links will then be made to packages in that location instead
of the default.

### Specifying a `namespace`

```sh
$ atlaspack-link --namespace @my-atlaspack-fork
```

When linking into a project that uses a fork of Atlaspack,
the published packages may have a different namespace from
Atlaspack, so `atlaspack-link` allows specifying a namespace.

If defined to someting other than `"@atlaspack"`,
`atlaspack-link` will do some extra work to adjust
namespaced packages to reference linked packages instead.

### Linking into a monorepo

```sh
$ atlaspack-link --node-modules-globs build-tools/*/node_modules build-tools/atlaspack/*/node_modules
```

In a monorepo, there may be multiple locations where
Atlaspack packages are installed. For this, `atlaspack-link`
allows specifying globs of locations where packages should be linked.

Note that specifying any value here will override the default of `node_modules`,
so if you want to preserve the default behavior, be sure to include `node_modules`
in the list of globs:

```sh
$ atlaspack-link -g build-tools/*/node_modules -g build-tools/atlaspack/*/node_modules -g node_modules
```

## Cleanup

To restore the project to its default Atlaspack install:

```sh
$ atlaspack-link unlink [options] [packageRoot]
```
