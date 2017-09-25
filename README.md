# bundler

A blazing fast, zero configuration web application bundler.

- 🚀 Blazing fast bundle times - multicore compilation, and a filesystem cache for fast rebuilds even after a restart.
- 📦 Out of the box support for JS, CSS, HTML, file assets, and more - no plugins to install.
- 🐠 Automatically transforms modules using Babel, PostCSS, and PostHTML when needed - even `node_modules`.
- 🔪 Zero configuration code splitting using dynamic `import()` statements.
- 🔥 Built in support for hot module replacement
- 🚨 Friendly error logging experience - syntax highlighted code frames help pinpoint the problem.

## Getting started

1. Install with npm:

```shell
npm install bundler -g
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
bundler index.html
```

4. Open http://localhost:1234/ in your browser.

## Why bundler?

There are many web application bundlers out there with huge adoption, including webpack and browserify. So, why do we need another one? The main reasons are around developer experience.

Many of the existing bundlers are built around configuration and plugins, and it is not uncommon to see applications with upwards of 500 lines of configuration just to get things working. This configuration is not just tedious and time consuming, but is also hard to get right. Oftentimes, this can lead to sub-optimized applications. `bundler` is designed to need zero configuration: just point it at the entry point of your application, and it does the right thing.

Existing bundlers are also very slow. Large applications with lots of files and many dependencies can take minutes to build, which is especially painful during development when things change all the time. File watchers can help with rebuilds, but the initial launch is often still very slow. `bundler` utilizes worker processes to compile your code in parallel, utilizing modern multicore processors. This results in a huge speedup for initial builds. It also has a file system cache, which saves the compiled results per file for even faster subsequent startups.

Finally, existing bundlers are built around string loaders/transforms, where the transformer takes in a string, parses it, does some transformation, and generates code again. Oftentimes this ends up causing many parses and code generation runs on a single file, which is inefficient. Instead, `bundler`'s transforms work on ASTs so that there is one parse, many transforms, and one code generation per file.
