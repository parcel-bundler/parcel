<p align="center">
  <a href="https://parceljs.org/" target="_blank">
    <img alt="Parcel" src="https://user-images.githubusercontent.com/19409/31321658-f6aed0f2-ac3d-11e7-8100-1587e676e0ec.png" width="749">
  </a>
</p>

## Features

- 🚀 **Blazing fast** bundle times - multicore compilation, and a filesystem cache for fast rebuilds even after a restart.
- 📦 Out of the box support for JS, CSS, HTML, file assets, and more - **no plugins to install**.
- 🐠 **Automatically transforms modules** using Babel, PostCSS, and PostHTML when needed - even `node_modules`.
- ✂️ Zero configuration **code splitting** using dynamic `import()` statements.
- 🔥 Built in support for **hot module replacement**
- 🚨 Friendly error logging experience - syntax highlighted code frames help pinpoint the problem.

## Getting started

1. Install with npm:

```shell
npm install parcel -g
```

2. Create an HTML entry point for your application, and link to your main JavaScript file:

```html
<html>
<body>
  <script src="./index.js"></script>
</body>
</html>
```

3. Start a dev server:

```shell
parcel index.html
```

4. Open http://localhost:1234/ in your browser.

## Why parcel?

There are many web application bundlers out there with huge adoption, including webpack and browserify. So, why do we need another one? The main reasons are around developer experience.

Many bundlers are built around configuration and plugins, and it is not uncommon to see applications with upwards of 500 lines of configuration just to get things working. This configuration is not just tedious and time consuming, but is also hard to get right and must be duplicated for each application. Oftentimes, this can lead to sub-optimized apps shipping to production. `parcel` is designed to need zero configuration: just point it at the entry point of your application, and it does the right thing.

Existing bundlers are also very slow. Large applications with lots of files and many dependencies can take minutes to build, which is especially painful during development when things change all the time. File watchers can help with rebuilds, but the initial launch is often still very slow. `parcel` utilizes worker processes to compile your code in parallel, utilizing modern multicore processors. This results in a huge speedup for initial builds. It also has a file system cache, which saves the compiled results per file for even faster subsequent startups.

Finally, existing bundlers are built around string loaders/transforms, where the transform takes in a string, parses it, does some transformation, and generates code again. Oftentimes this ends up causing many parses and code generation runs on a single file, which is inefficient. Instead, `parcel`'s transforms work on ASTs so that there is one parse, many transforms, and one code generation per file.

## How it works

`parcel` transforms a tree of assets to a tree of bundles. Many other bundlers are fundamentally based around JavaScript assets, with other formats tacked on - for example, by default inlined as strings into JS files. `parcel` is file-type agnostic - it will work with any type of assets the way you'd expect, with no configuration.

`parcel` takes as input a single entry asset, which could be any type: a JS file, HTML, CSS, image, etc. There are various asset types defined in `parcel` which know how to handle specific file types. The assets are parsed, their dependencies are  extracted, and they are transformed to their final compiled form. This creates a tree of assets.

Once the asset tree as been constructed, the assets are placed into a bundle tree. A bundle is created for the entry asset, and child bundles are created for dynamic imports, which cause code splitting to occur. Child bundles are also created when assets of a different type are imported, for example if you imported a CSS file from JavaScript, it would be placed into a sibling bundle to the corresponding JavaScript. If an asset is required in more than one bundle, it is hoisted up to the nearest common ancestor in the bundle tree so it is not included more than once.

After the bundle tree is constructed, each bundle is written to a file by a packager specific to the file type. The packagers know how to combine the code from each asset together into the final file that is loaded by a browser.

## License

MIT

