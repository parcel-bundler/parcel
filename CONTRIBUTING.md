# Contributing

Welcome, we really appreciate if you're considering to contribute, the joint effort of our contributors make projects like this possible!

The goal of this document is to provide guidance on how you can get involved.

## Asking questions

Have a question or feature request? Rather than opening an issue, use the [Discussions](https://github.com/parcel-bundler/parcel/discussions) board.

Please be polite and take the time to write a well-worded question so our community members can easily assist you.

## Prerequisites

Before starting make sure you have the following installed:

- [git](https://git-scm.com)
- [Node](https://nodejs.org) at LTS
- [Yarn](https://yarnpkg.com) at v4 and/or enable corepack
- [Rust](https://www.rust-lang.org/tools/install) stable

## Getting started

In order to make it easier to get familiar with the codebase we labeled simpler issues using [Good First Issue](https://github.com/parcel-bundler/parcel/issues?q=is%3Aopen+is%3Aissue+label%3A%22%E2%9C%A8+Parcel+2%22+label%3A%22%3Ababy%3A+Good+First+Issue%22) and [Help Wanted](https://github.com/parcel-bundler/parcel/issues?q=is%3Aopen+is%3Aissue+label%3A%22%E2%9C%A8+Parcel+2%22+label%3A%22%3Apray%3A+Help+Wanted%22). You can learn the internals by reading the [documentation](https://parceljs.org/docs) or by starting from `packages/core/core/src/Parcel.js`

## Pull requests

For significant changes, it is recommended that you first [propose your solution](https://github.com/parcel-bundler/parcel/discussions) and gather feedback.

**Before submitting a pull request,** you can follow this step by step guide:

1. [Fork](https://docs.github.com/en/github/getting-started-with-github/fork-a-repo) the repository and setup a new branch to work in.

> It's important that the changes are made in separate branches to ensure a pull request only includes the commits related to a bug or feature.

2. Run `yarn` in the repository root to install dependencies.
3. If you fix a bug or introduce a new feature, add tests or ask for help if the use-case is more complex.
4. Commit the `yarn.lock` file if it has changed.
5. Check the steps used in [CI](.github/workflows/v3.yml) pass locally.

```sh
$ yarn check-ts
$ yarn lint
$ yarn test
```

⚠️ Don't modify the `package.json` versioning

Once you are ready to create a pull request, provide relevant details about the change; examples; and test cases. All submissions require review, so please be patient!

## Development workflow

The following commands are available:

- `yarn check-ts` runs TypeScript type checking.
- `yarn format` keeps the code formatting consistent.
- `yarn lint` checks for stylistic or unwanted errors.
- `yarn test` runs the tests.

### Debugging

Both VSCode and CLion can be used to debug commands such as the integration test suite.

- **CLion** is well supported, using default configurations for the relevant language.
- **VSCode** users can use the JavaScript Debug Terminal or Node.js launch configuration to debug JavaScript. Rust debugging requires a [LLDB](https://lldb.llvm.org/) powered launch configuration, which is available by installing the [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) extension.

**Breakpoints not triggering?** Try passing in `PARCEL_WORKERS=0` to make all code run on the main thread, instead of in worker processes. Similarly, you can set `PARCEL_MAX_CONCURRENT_CALLS` to change the limit of concurrent calls per worker.

### Plugins

When developing plugins, you should disable caching with the `--no-cache` CLI or `shouldDisableCache: true` Parcel option. This will ensure you do not see stale or incomplete results.

### Working from an example

_Please don't commit these examples._

You can create a temporary example for debugging in the folder `packages/examples`. Start by copying the `simple` example and try to reproduce the bug. It has everything setup for working on local changes and you can run `yarn build` to build the project. If you're re-using another example or creating one from scratch, make sure to use the `--no-cache` flag for `parcel build` to see your local changes reflected.

### Testing outside of the monorepo

You can run `/path/to/monorepo/packages/core/parcel/src/bin.js build src/index.html` provided that you don't have any `@parcel/*` plugins installed in this project.

## Releasing a new version

Releases are published by the [parcel3 workflow](.github/workflows/parcel3.yml). Run it from the Actions tab with the version to release (e.g. `3.0.0-alpha.1`) and `publish` checked. It builds Parcel for every target and publishes it as both `parcel` and `@parcel/parcel3` (which installs a `parcel3` command, so it can be used beside Parcel 2), and versions and publishes the JS packages in `packages-v3` with Yarn. Without `publish` checked, it only builds and packs everything, so the result can be checked first.

The JS packages are published to a dist-tag named after the prerelease identifier (e.g. `alpha`), or `latest` for a stable version, unless the `tag` input is set.

## Become a backer or sponsor

Showing appreciation makes us happy, donations help us grow.

Our financial situation is fully transparent on our [open collective](https://opencollective.com/parcel).

Anyone can file an expense. If the expense makes sense for the development of the community, it will be "merged" in the ledger of our open collective by the core contributors and the person who filed the expense will be reimbursed.

## Credits

### Contributors

Thank you to all the people who have already contributed to parcel!
<a href="https://github.com/parcel-bundler/parcel/graphs/contributors"><img src="https://opencollective.com/parcel/contributors.svg?width=890" /></a>

### Backers

Thank you to all our backers! [[Become a backer](https://opencollective.com/parcel#backer)]

<a href="https://opencollective.com/parcel#backers" target="_blank"><img src="https://opencollective.com/parcel/backers.svg?width=890"></a>

### Sponsors

Thank you to all our sponsors! (please ask your company to also support this open source project by [becoming a sponsor](https://opencollective.com/parcel#sponsor))

<a href="https://opencollective.com/parcel/sponsor/0/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/1/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/2/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/3/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/4/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/5/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/6/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/7/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/8/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/parcel/sponsor/9/website" target="_blank"><img src="https://opencollective.com/parcel/sponsor/9/avatar.svg"></a>
