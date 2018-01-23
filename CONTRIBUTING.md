# Contributing

## Wiki

See (and edit!) our public Wiki.

Useful notes for new contributors:

https://github.com/parcel-bundler/parcel/wiki/Contributing

We encourage you to create new pages or make helpful edits to all parts of the wiki. Try to ask before making major changes to pages you didn't create, but just do whatever you think is best. Feel free to make a user page and collect your notes there so everyone can learn.

## Slack

Join our public Slack: https://slack.parceljs.org/

The #contributors channel is useful. If you want help or have questions about any aspect of Parcel development, ask there! We'll see and respond.

It's important to us to give a good experience to new contributors, so anything you want to do is fair game. Feel free to come chat about it, or open a new [issue](https://github.com/parcel-bundler/parcel/issues/new) with RFC in the title.

## Overview

* `yarn install` - install all dependencies
* `yarn build` - run src/ through [babel] into lib/
* `yarn test` - run all tests in repo
* `yarn format` - run [prettier] on all files

## Getting Started

To get started with the project:

You'll need [Git], [Node], and [Yarn] installed. Then clone the repository:

```js
git clone git@github.com:parcel-bundler/parcel.git && cd parcel
```

Run Yarn:

```js
yarn install
```

Run tests:

```js
yarn test
```

[babel]: http://babeljs.io/
[prettier]: https://prettier.io/
[git]: https://git-scm.com/
[node]: https://nodejs.org/
[yarn]: https://yarnpkg.com/

## Environment variables, command line arguments

You can set `PARCEL_WORKERS` to the number of worker processes to spawn.

**NOTE:** `PARCEL_WORKERS=0` is handy for debugging, because all code will run on the main thread. You can then place breakpoints in Asset code. (Normally these breakpoints won't trigger, because the code executes in a subprocess.)

**NOTE:** When developing plugins or new Asset types, run with `--no-cache` (or pass `cache: false` to `Bundler` options). Parcel uses caching by default, but during development you'll normally pass incomplete results into the cache. This can leave you wondering why you're constantly seeing old results.

## Financial contributions

We also welcome financial contributions in full transparency on our [open collective](https://opencollective.com/parcel).
Anyone can file an expense. If the expense makes sense for the development of the community, it will be "merged" in the ledger of our open collective by the core contributors and the person who filed the expense will be reimbursed.

## Credits

### Contributors

Thank you to all the people who have already contributed to parcel!
<a href="graphs/contributors"><img src="https://opencollective.com/parcel/contributors.svg?width=890" /></a>

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
