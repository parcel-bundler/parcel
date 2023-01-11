# Contributing

Welcome, we really appreciate if you're considering to contribute, the joint effort of our contributors make projects like this possible!

The goal of this document is to provide guidance on how you can get involved.

## Asking questions

Have a question or feature request? Rather than opening an issue, use the [Discussions](https://github.com/parcel-bundler/parcel/discussions) board.

Please be polite and take the time to write a well-worded question so our community members can easily assist you.

## Getting started with bug fixing

In order to make it easier to get familiar with the codebase we labeled simpler issues using [Good First Issue](https://github.com/parcel-bundler/parcel/issues?q=is%3Aopen+is%3Aissue+label%3A%22%E2%9C%A8+Parcel+2%22+label%3A%22%3Ababy%3A+Good+First+Issue%22) and [Help Wanted](https://github.com/parcel-bundler/parcel/issues?q=is%3Aopen+is%3Aissue+label%3A%22%E2%9C%A8+Parcel+2%22+label%3A%22%3Apray%3A+Help+Wanted%22).

Before starting make sure you have the following requirements installed: [git](https://git-scm.com), [Node](https://nodejs.org), [Yarn](https://yarnpkg.com) and [Rust](https://www.rust-lang.org/tools/install).

Parcel uses [Flow](https://flow.org) for type checking. If you're using an IDE, make sure to install the [Flow extension](https://flow.org/en/docs/editors/) to ensure your editor's autocomplete and type-checking works as expected.

The process starts by [forking](https://docs.github.com/en/github/getting-started-with-github/fork-a-repo) the project and setup a new branch to work in. It's important that the changes are made in separated branches in order to ensure a pull request only includes the commits related to a bug or feature.

Clone the forked repository locally and install the dependencies:

```sh
git clone https://github.com/USERNAME/parcel.git
cd parcel
yarn install
yarn build-native
```

If you want, you can create a temporary example for debugging in the folder `packages/examples`. You can start by copying the `simple` example and try to reproduce the bug. It has everything set up for working on local changes and you can run `yarn build` to build the project. If you're re-using another example or creating one from scratch, make sure to use the `--no-cache` flag for `parcel build` to see your local changes reflected. _Please don't commit this example._

After you've figured out where the issue originated from and found a fix, try to add a test case or ask for help on how to proceed if the use case is more complex.

Use `yarn test` to run all unit and integration tests. Make sure all tests pass before submitting a pull request.

Use `yarn format` to make sure we keep the code format consistent.

Use `yarn lint` to check for stylistic or unwanted errors.

If you want to test out your change outside the monorepo, you can run `/path/to/monorepo/packages/core/parcel/src/bin.js build src/index.html` (provided that you don't have any `@parcel/*` plugins installed in this project).

## Notes and things to be aware of

If you're just getting started to understand how the internals work, start from `/packages/core/core/src/Parcel.js`

⚠️ You can set `PARCEL_WORKERS` to the number of worker processes to spawn. `PARCEL_WORKERS=0` is handy for debugging, because all code will run on the main thread. You can then place breakpoints in Asset code. (Normally these breakpoints won't trigger, because the code executes in a subprocess.)

⚠️ When developing plugins, run with `--no-cache` (or pass `shouldDisableCache: true` to `Parcel` options). Parcel uses caching by default, but during development you'll normally pass incomplete results into the cache. This can leave you wondering why you're constantly seeing old results.

You can set `PARCEL_MAX_CONCURRENT_CALLS` to change the limit of concurrent calls per worker.

## Pull requests

For significant changes, it is recommended that you first [propose your solution](https://github.com/parcel-bundler/parcel/discussions) and gather feedback.

A few things to keep in mind before submitting a pull request:

- do your best to provide relevant test cases
- if you added an external dependency commit the updated `yarn.lock`
- don't modify the `package.json` versioning
- all submissions require review, please be patient

## Releasing a new version

When releasing a new version of Parcel a couple steps should be followed:

1. Run `yarn tag:prerelease 2.0.0-alpha.1` or `yarn tag:release 2.4.5` based on whether it is a prerelease (alpha, beta, nightly, ...) or a stable release
2. Open a PR (or commit directly to the default branch)
3. Wait for the PR to get merged
4. Create a [GitHub release](https://github.com/parcel-bundler/parcel/releases) and publish it (this should automatically trigger an npm release, with the current state of the default branch and versions defined in the `package.json` files)

After these steps are completed there should be a new version of Parcel published on npm.

In case the automatic npm release failed, or you want to do a manual release for any other reason you can also run `yarn run release`

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
