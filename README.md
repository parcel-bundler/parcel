<p align="center">
  <a href="https://parceljs.org/" target="_blank">
    <img alt="Parcel" src="https://user-images.githubusercontent.com/19409/31321658-f6aed0f2-ac3d-11e7-8100-1587e676e0ec.png" width="749">
  </a>
</p>

[![Backers on Open Collective](https://opencollective.com/parcel/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/parcel/sponsors/badge.svg)](#sponsors)
[![Travis CI Build Status](https://travis-ci.org/parcel-bundler/parcel.svg?branch=master)](https://travis-ci.org/parcel-bundler/parcel)
[![Appveyor Build status](https://ci.appveyor.com/api/projects/status/nr7d6qjxj3wwsw6n?svg=true)](https://ci.appveyor.com/project/devongovett/parcel)
[![David Dependancy Status](https://david-dm.org/parcel-bundler/parcel.svg)](https://david-dm.org/parcel-bundler/parcel)
[![npm package](https://img.shields.io/npm/v/parcel-bundler.svg)](https://www.npmjs.com/package/parcel-bundler)
[![npm package](https://img.shields.io/npm/dm/parcel-bundler.svg)](https://www.npmjs.com/package/parcel-bundler)
[![Slack](https://slack.parceljs.org/badge.svg)](https://slack.parceljs.org)
[![Twitter Follow](https://img.shields.io/twitter/follow/parceljs.svg?style=social)](https://twitter.com/parceljs)

## Features

* 🚀 **Blazing fast** bundle times - multicore compilation, and a filesystem cache for fast rebuilds even after a restart.
* 📦 Out of the box support for JS, CSS, HTML, file assets, and more - **no plugins to install**.
* 🐠 **Automatically transforms modules** using Babel, PostCSS, and PostHTML when needed - even `node_modules`.
* ✂️ Zero configuration **code splitting** using dynamic `import()` statements.
* 🔥 Built in support for **hot module replacement**
* 🚨 Friendly error logging experience - syntax highlighted code frames help pinpoint the problem.

## Getting started

1. Install with yarn:

```shell
yarn global add parcel-bundler
```

or with npm:

```shell
npm install -g parcel-bundler
```

2. Parcel can take any type of file as an entry point, but an HTML or JavaScript file is a good place to start. If you link your main JavaScript file in the HTML using a relative path, Parcel will also process it for you, and replace the reference with a URL to the output file.

```html
<html>
<body>
  <script src="./index.js"></script>
</body>
</html>
```

3. Parcel has a development server built in, which will automatically rebuild your app as you change files and supports hot module replacement for fast development. Just point it at your entry file:

```shell
parcel index.html
```

4. Now open http://localhost:1234/ in your browser. If needed, you can also override the default port with the -p option.

See [parceljs.org](https://parceljs.org) for more documentation!

## Benchmarks

Based on a reasonably sized app, containing 1726 modules, 6.5M uncompressed. Built on a 2016 MacBook Pro with 4 physical CPUs.

| Bundler                 | Time      |
| ----------------------- | --------- |
| browserify              | 22.98s    |
| webpack                 | 20.71s    |
| **parcel**              | **9.98s** |
| **parcel - with cache** | **2.64s** |

## Why parcel?

There are many web application bundlers out there with huge adoption, including webpack and browserify. So, why do we need another one? The main reasons are around developer experience.

Many bundlers are built around configuration and plugins, and it is not uncommon to see applications with upwards of 500 lines of configuration just to get things working. This configuration is not just tedious and time consuming, but is also hard to get right and must be duplicated for each application. Oftentimes, this can lead to sub-optimized apps shipping to production. `parcel` is designed to need zero configuration: just point it at the entry point of your application, and it does the right thing.

Existing bundlers are also very slow. Large applications with lots of files and many dependencies can take minutes to build, which is especially painful during development when things change all the time. File watchers can help with rebuilds, but the initial launch is often still very slow. `parcel` utilizes worker processes to compile your code in parallel, utilizing modern multicore processors. This results in a huge speedup for initial builds. It also has a file system cache, which saves the compiled results per file for even faster subsequent startups.

Finally, existing bundlers are built around string loaders/transforms, where the transform takes in a string, parses it, does some transformation, and generates code again. Oftentimes this ends up causing many parses and code generation runs on a single file, which is inefficient. Instead, `parcel`'s transforms work on ASTs so that there is one parse, many transforms, and one code generation per file.

## How it works

`parcel` transforms a tree of assets to a tree of bundles. Many other bundlers are fundamentally based around JavaScript assets, with other formats tacked on - for example, by default inlined as strings into JS files. `parcel` is file-type agnostic - it will work with any type of assets the way you'd expect, with no configuration.

`parcel` takes as input a single entry asset, which could be any type: a JS file, HTML, CSS, image, etc. There are various asset types defined in `parcel` which know how to handle specific file types. The assets are parsed, their dependencies are extracted, and they are transformed to their final compiled form. This creates a tree of assets.

Once the asset tree has been constructed, the assets are placed into a bundle tree. A bundle is created for the entry asset, and child bundles are created for dynamic imports, which cause code splitting to occur. Child bundles are also created when assets of a different type are imported, for example if you imported a CSS file from JavaScript, it would be placed into a sibling bundle to the corresponding JavaScript. If an asset is required in more than one bundle, it is hoisted up to the nearest common ancestor in the bundle tree so it is not included more than once.

After the bundle tree is constructed, each bundle is written to a file by a packager specific to the file type. The packagers know how to combine the code from each asset together into the final file that is loaded by a browser.

## Community

All feedback and suggestions are welcome!

* 💬 Chat: Join us on [slack](https://slack.parceljs.org/).
* 📣 Stay up to date on new features and announcements on [@parceljs](https://twitter.com/parceljs).

## Contributors

This project exists thanks to all the people who contribute. [[Contribute]](CONTRIBUTING.md).
<a href="graphs/contributors"><img src="https://opencollective.com/parcel/contributors.svg?width=890" /></a>

## Backers

Thank you to all our backers! 🙏 [[Become a backer](https://opencollective.com/parcel#backer)]

<a href="https://opencollective.com/parcel#backers" target="_blank"><img src="https://opencollective.com/parcel/backers.svg?width=890"></a>

## Sponsors

Support this project by becoming a sponsor. Your logo will show up here with a link to your website. [[Become a sponsor](https://opencollective.com/parcel#sponsor)]

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

## License

MIT
