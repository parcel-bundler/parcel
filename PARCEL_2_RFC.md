# Parcel 2 RFC

This RFC is written as documentation for the project, our documentation should
be detailed enough to work as a spec, and it's easier to write it once this way
than to approve a spec and start again on the documentation from scratch.

Everything in Parcel should be documented here, if it is not documented it will
not be part of Parcel 2.

---

## Introduction

Parcel is a compiler for all your code, regardless of the language or toolchain.

Parcel takes all of your files and dependencies, transforms them, and merges
them together into a smaller set of output files that can be used to run your
code.

Parcel supports many different languages and file types out of the box, from
web technologies like HTML, CSS, and JavaScript, to lower level languages like
Rust, and anything that compiles to WebAssembly (WASM), to assets like images,
fonts, videos, and more.

Parcel makes your code portable, you can build your code for different
environments, for the web for your server, or for an app. You can even build
multiple targets at once and have them live update as you make changes.

Parcel is fast and predictable. It compiles all of your files in isolation in
parallel inside workers, caching all of them as it goes along. Caches are
stable across machines and are only affected by the files and configs within
your project (unless you want to pass specific environment variables).

## Getting Started

Before we get started, you'll need to install Node and Yarn (or npm) and create
a `package.json` for your project if you haven't already.

```sh
yarn init
```

Then with Yarn you can install `parcel` into your app:

```sh
yarn add --dev parcel
```

From there you just need to point Parcel at some of your entry files. Like if
you're building a website, an `index.html` file:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>My First Parcel App</title>
  </head>
  <body>
    <h1>Hello, World!</h1>
  </body>
</html>
```

Now if you just run:

```sh
yarn parcel --serve
```

You should get a URL that looks something like: `http://localhost:1234/`

Next you can start adding dependencies by specifying them in your code (however
your language specifies other assets). So for HTML we could create a
`styles.css` file next to our `index.html` file and include it with a `<link>`
tag.

```css
h1 {
  color: hotpink;
  font-family: cursive;
}
```

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>My First Parcel App</title>
    <link rel="stylesheet" href="./styles.css"/>
  </head>
  <body>
    <h1>Hello, World!</h1>
  </body>
</html>
```

As we make the change you should see the website update with your changes
without even refreshing the page.

## Parcel CLI

The Parcel CLI is built into the main `parcel` package. While you can install
it globally and run it, it is much better to install it locally into your
project as a dev dependency.

```sh
yarn add --dev parcel
```

You should also add some "scripts" to your `package.json` to run it easier.

```json
{
  "name": "my-project",
  "scripts": {
    "build": "parcel --production",
    "start": "parcel --serve"
  },
  "devDependencies": {
    "parcel": "latest"
  }
}
```

Now you can run `yarn build` to bundle your project for production and
`yarn start` to dev on your project.

### CLI Args & Flags

Usage:

```sh
$ parcel [...entries] [...flags]
```

#### `[...entries]`

Entry files to start bundling, these will be preserved as entry points in the
output. Defaults to `package.json#source`, falling back to `src/index.*` or
`index.*`. See [#Entries](#entries-sources-targets-environment).

#### `--serve, -s`

Serve assets on a local server

#### `--watch, -w`

Watch and rebuild code on file changes.

#### `--open, -o [browser]`

Open your local server in a browser. You can optionally pass the name of the
browser you want to open, otherwise it will use your default browser.

#### `--port <port>`

Configure the port to serve assets on. Alternatively you can use the `$PORT`
environment variable.

#### `--https`

This will generate a local certificate (which will be untrusted by your
browser, you'll need to approve it) and serve your assets over `https://`

##### `--cert <path>`

Specify the filepath to your SSL certificate when using `--https`.

##### `--key <path>`

Specify the filepath to your SSL key when using `--https`.

#### `--cache <dir>`, `--no-cache`

Configure the cache directory with `--cache <dir>` or disable it altogether
with `--no-cache`.

#### `--hot`, `--no-hot`

Turn hot reloading on or off.

##### `--hot-hostname <hostname>`

Configure the hot reloading hostname.

##### `--hot-port <port>`

Configure the hot reloading port.

#### `--[no-]source-maps`

Turn source maps on or off. Source maps are turned on by default except in
production builds.

#### `--autoinstall [npm/yarn], --no-autoinstall`

When enabled, whenever Parcel discovers a dependency that isn't installed it
will attempt to install it with either npm or Yarn (defaults to npm unless a
`yarn.lock` exists).

#### `--mode <mode>`

Override the environment mode, including those manually configured to something
else (ex. `--mode production` or `--mode development`). Defaults to the
`NODE_ENV` environment variable.

##### `--development, --dev`

Aliases for `--mode development`.

##### `--production, --prod`

Aliases for `--mode production`.

##### `--test`

Aliases for `--mode test`.

#### `--public-url <url>`

[todo]

#### `--log-level <level>`

Set the log level, either "0" (no output), "1" (errors), "2" (warnings +
errors) or "3" (all). (Default: 2)

#### `--version, -v, -V`

Return the current version of Parcel.

#### `--help, -h`

Get help with the CLI.

## Parcel Config

Parcel has always and will always work out of the box for many projects with
zero configuration. It should always be extremely simple to get started. But if
you do want more control, we give you the tools to do so.

### Configuring external tools

A huge part of what Parcel does is run other tools over your code. Instead of
pulling all that configuration into Parcel, we make use of their own
configuration systems. So if you're using Babel, you should just use `.babelrc`
files to configure it.

When we do need to introduce config, we create tool specific config files in
order to do so.

### Configuring Parcel

When you do need to configure Parcel, it will be in one of 3 places.

- If you need to configure the CLI, it will be a CLI flag
- If you need to configure your package, it will be in the `package.json`
- If you need to configure something with your files or the Parcel asset
  pipeline, it will be in `.parcelrc`

### `package.json`

[todo]

```json
{
  "name": "foo",
  "main": "dist/main/index.js",
  "module": "dist/module/index.js",
  "browser": "dist/browser/index.js",
  "browserslist": ["> 1%", "not dead"],
  "engines": {
    "node": ">=4.x"
  },
  "source": "src/index.js",
  "targets": {
    "main": {
      "node": ["^4.0.0"]
    },
    "module": {
      "node": ["^8.0.0"]
    },
    "browser": {
      "browsers": ["> 1%", "not dead"]
    }
  },
  "alias": {
    "react": "preact-compat",
    "react-dom": "preact-compat"
  }
}
```

#### `package.json#name`

**(Required)** The name of the package is always required in order to be
considered a valid `package.json`.

```json
{
  "name": "my-package"
}
```

#### `package.json#version`

**(Required)** All packages inside `node_modules` must have a `package.json#version`.

```json
{
  "version": "1.0.0"
}
```

#### `package.json#main`

**(Required)** This is the "main" target's entry point for the package.

```json
{
  "main": "dist/main/index.js"
}
```

See [Targets](#targets)

#### `package.json#module`

This is the "module" target's entry point for the package.

```json
{
  "module": "dist/module/index.js"
}
```

See [Targets](#targets)

#### `package.json#browser`

This is the "browser" target's entry point for the package.

```json
{
  "browser": "distflinesof/browser/index.js"
}
```

See [Targets](#targets)

#### `package.json#source`

Specify the entry points for your source code which gets mapped to your
targets.

```json
{
  "source": "src/index.js",
  "source": ["src/index.js", "src/index.html"]
}
```

See [Sources](#sources)

#### `package.json#browserslist`

As specified by Browserslist, this field is for specifying which transforms
should be applied to browser bundles.

```json
{
  "browserslist": ["> 0.2%", "not dead"]
}
```

See [Environments](#environments)

#### `package.json#engines`

Specify what versions of what engines you want to support.

```json
{
  "engines": {
    "node": ">=4.x",
    "electron": ">=2.x"
  }
}
```

See [Environments](#environments)

#### `package.json#targets`

Configuration for individual targets.

```json
{
  "targets": {
    "main": {
      "engines": {
        "node": ">=4.x",
        "electron": ">=2.x"
      },
      "browsers": ["> 1%", "not dead"]
    }
  }
}
```

See [Targets](#targets)

#### `package.json#alias`

Aliases asset names/paths to other assets.

```json
{
  "alias": {
    "react": "preact-compat",
    "react-dom": "preact-compat"
  }
}
```

See [Aliases](#aliases)

### `.parcelrc`

Your `.parcelrc` file will likely contain just a few fields (if you have one at
all), but here's an example of a `.parcelrc` file that contains every field:

```json
{
  "extends": ["@parcel/config-default"],
  "resolvers": ["@parcel/resolver-default"],
  "bundler": "@parcel/bundler-default",
  "transforms": {
    "*.vue": ["@parcel/transform-vue"],
    "*.scss": ["@parcel/transform-sass"],
    "*.js": ["@parcel/transform-babel"],
    "*.css": ["@parcel/transform-postcss"],
    "*.html": ["@parcel/transform-posthtml"],
  },
  "packagers": {
    "*.js": "@parcel/packager-js",
    "*.css": "@parcel/packager-css",
    "*.html": "@parcel/packager-html",
    "*.wasm": "@parcel/packager-wasm",
    "*.raw": "@parcel/packager-raw"
  },
  "optimizers": {
    "*.js": ["@parcel/optimizer-uglify"],
    "*.css": ["@parcel/optimizer-cssnano"],
    "*.html": ["@parcel/optimizer-htmlnano"],
    "*.{png,jpg,jpeg,svg,...}": ["@parcel/optimizer-imagemin"]
  },
  "loaders": {
    "*.js": "@parcel/loader-js",
    "*.wasm": "@parcel/loader-wasm"
  },
  "reporters": ["@parcel/reporter-detailed"]
}
```

#### Glob maps in `.parcelrc`

Many config properties like `transforms` or `packagers` use objects as maps of
globs to package names. While objects in JSON are technically unordered, Parcel
does use the order to give globs priority when a file name is being tested
against them.

```json
{
  "transforms": {
    "icons/*.svg": ["highest-priority"],
    "*.svg": ["lowest-priority"]
  }
}
```

Here if we are trying to find a transform for the file `icons/home.svg`, we'll
work our way down the globs until we find a match, which would be
`icons/*.svg`, we never reach `*.svg`.

#### `.parcelrc#extends`

`extends` can either be a string or an array of strings that specify base
configs to extend. That base configuration can be the path to another
`.parcelrc` file or the name of a Parcel config package.

```json
{
  "extends": "@parcel/config-default",
  "extends": "../.parcelrc",
  "extends": ["@parcel/config-default", "@company/parcel-config"]
}
```

When extending a config, Parcel does a shallow merge of the two configs.

#### `.parcelrc#resolvers`

`resolvers` is an array of strings that specifies the name of a Parcel resolver
package.

```json
{
  "resolvers": ["@parcel/resolver-default"]
}
```

See [Resolvers](#resolvers)

#### `.parcelrc#transforms`

`transforms` is an object map of globs to arrays of Parcel transform packages.

```json
{
  "transforms": {
    "*.js": ["@parcel/transform-babel"]
  }
}
```

See [Transforms](#transforms)

#### `.parcelrc#bundler`

`bundler` is a string that specifies the name of a Parcel bundler package.

```json
{
  "bundler": "@parcel/bundler-v1"
}
```

See [Bundlers](#bundlers)

#### `.parcelrc#packagers`

`packagers` is an object map of globs to Parcel packager packages.

```json
{
  "packagers": {
    "*.js": ["@parcel/packager-js"]
  }
}
```

See [Packagers](#packagers)

#### `.parcelrc#optimizers`

`optimizers` is an object map of globs to arrays of Parcel optimizer packages.

```json
{
  "optimizers": {
    "*.js": ["@parcel/optimizer-uglify"]
  }
}
```

See [Optimizers](#optimizers)

#### `.parcelrc#loaders`

`loaders`  is an object map of globs to Parcel loader packages. See
[Loaders](#).

```json
{
  "loaders": {
    "*.js": "@parcel/loader-js",
    "*.wasm": "@parcel/loader-wasm"
  }
}
```

See [Loaders](#loaders)

#### `.parcelrc#reporters`

`reporters` is an array of Parcel reporter packages. See [Reporters](#).

```json
{
  "reporters": ["@parcel/reporter-detailed"]
}
```

See [Reporters](#reporters)

## Parcel Architecture

Even if you aren't doing anything that complex, if you are going to use Parcel
a lot it makes sense to take some time and understand how it works.

### Phases of Parcel

At a high level Parcel runs through several phases:

- Resolving
- Transforming
- Bundling
- Packaging
- Optimizing

The **resolving** and **transforming** phases work together in parallel to
build a graph of all your assets.

This asset graph gets translated into bundles in the **bundling** phase.

Then the **packaging** phase takes the assets in the calculated bundles and
merges them together into files each containing an entire bundle.

Finally, in the **optimizing** phase, Parcel takes these bundles files and runs
them through optimizing transforms.

### Asset Graph

During the resolving and transforming phases, Parcel discovers all the assets
in your app or program. Every asset can have it's own dependencies on other
assets which Parcel will pull in.

The data structure that represents all of these assets and their dependencies
on one another is known as "The Asset Graph".

| Asset Name   | Dependencies        |
| ------------ | ------------------- |
| `index.html` | `app.css`, `app.js` |
| `app.css`    | N/A                 |
| `app.js`     | `navbar.js`         |
| `navbar.js`  | etc.                |

### Bundles

Once Parcel has built the entire Asset Graph, it begins turning it into
"bundles". These bundles are groupings of assets that get placed together in a
single file.

Bundles will (generally) contain only assets in the same language:

| Bundle Name  | Assets                      |
| ------------ | --------------------------- |
| `index.html` | `index.html`                |
| `app.css`    | `app.css`                   |
| `app.js`     | `app.js`, `navbar.js`, etc. |

Some assets are considered "entry" points into your app, and will stay as
separate bundles. For example, if your `index.html` file links to an
`about.html` file, they won't be merged together.

| Bundle Name  | Assets       | Entry URL |
| ------------ | ------------ | --------- |
| `index.html` | `index.html` | `/`       |
| `about.html` | `about.html` | `/about`  |

### Sources

"Sources" are the files that contain the source code to your app before being
compiled by Parcel.

Parcel discovers these sources by following their dependencies on one another
starting at your "entries".

These entries will be one of:

1. `$ parcel <...entries>`
2. `~/package.json#source`
3. `./src/index.*`
4. `./index.*`

From there, everything those assets depend on will be considered a "source" in
Parcel.

### Targets

When Parcel runs, it can build your asset graph in multiple different ways
simultaneously. These are called "targets".

For example, you could have a "modern" target that *targets* newer browsers
and a "legacy" target for older browsers.

Sources get mapped to targets,

#### Target Configuration

In the most explicit form, targets are configured via the
`package.json#targets` field.

```js
{
  "browser": "dist/browser/index.js",
  "browserModern": "dist/browserModern/index.js",
  "targets": {
    "browser": { /* target env */ },
    "browserModern": { /* target env */ }
  }
}
```

Each target has a name which corresponds to a top-level `package.json` field
such as `package.json#main` or `package.json#browser` which specify the primary
entry point for that target.

Inside each of those targets contains the target's environment configuration.

However, a lot of the normal configuration you might want will already have
defaults provided for you:

```cs
targets = {
  main: {
    node: value("package.json#engines.node"),
    browsers: unless exists("package.json#browser") then value("package.json#browserlist"),
  },
  module: {
    node: value("package.json#engines.node"),
    browsers: unless exists("package.json#browser") then value("package.json#browserlist"),
  },
  browser: {
    browsers: value("package.json#browserslist"),
  },
  ...value("package.json#targets"),
}
```

### Environments

Environments tell Parcel how to transform and bundle each asset. They tell
Parcel if an asset is going to be run in a browser or in NodeJS/Electron.

They also tell Parcel's transform plugins how they should run. They tell
[Babel](http://babeljs.io/docs/en/babel-preset-env#targetsbrowsers) or
[Autoprefixer](https://github.com/postcss/autoprefixer#browsers) what browsers
your asset is targetting.

You can configure environments through your targets.

```json
{
  "targets": {
    "main": {
      "node": ">=4.x",
      "electron": ">=2.x",
      "browsers": ["> 1%", "not dead"]
    }
  }
}
```


When one asset depends on another, the environment is inherited from its
parent. But how you depend on the asset can change some properties of that
environment.

For example:

```js
navigator.serviceWorker.register('./service-worker.js');
```

```js
let childEnvironment = { ...parentEnvironment, browserContext: 'service-worker' }
```

### Caching

Parcel will create a  `/node_modules/.cache/parcel` directory

The top-level directory will be filled with directories with two letters, which
are the start of a hash which is finished by the names of the JSON files inside.

```
/node_modules/.cache/parcel/
  /00/
    213debd8ddd45819b79a3a974ed487.json
    40ae9b581afc53841307a4b3c2463d.json
    63a9dd58fc1e8f8bb819759ea9793c.json
    ...
  /01/
  /../
  /zy/
  /zz/
```

It follows this weird structure in order to avoid too many files being created
in a single directory which degrades file system performance.

## Asset Resolution

Parcel follows the Node module resolution algorithm with a few additions.

### Local Paths

```
./path/to/file
./path/to/file.js
```

These follow the [Node module resolution algorithm](https://nodejs.org/api/modules.html#modules_all_together).

### Package Paths

```
preact
lodash/cloneDeep
@sindresorhus/is
```

These follow the [Node module resolution algorithm](https://nodejs.org/api/modules.html#modules_all_together).

### URLs

```
https://unpkg.com/preact@8.2.9/dist/preact.min.js
```

Parcel by default will ignore URL dependencies, other resolver plugins may
choose to do something with them.

### Tilde Paths

```
~/src/file.js
```

Only when used outside of `node_modules` directories, the `~` is replaced by an
absolute path to the closest package root:

```sh
/path/to/app #(/package.json)
```

To form a path that looks like:

```
/path/to/app/src/file.js
```

Then it follows the [Node module resolution algorithm](https://nodejs.org/api/modules.html#modules_all_together).

### Aliases

Aliases come in two forms:

1. Package Aliases: `react -> preact`
2. File/Directory Aliases: `utils` -> `./src/utils`

```json
{
  "name": "my-project",
  "alias": {
    "react": "preact-compat",
    "react-dom": "preact-compat",
    "utils": "./src/utils",
    "components": "./src/components"
  }
}
```

There are a couple of rules:

1. Aliases will only be respected when specified outside of `node_modules`.
2. Aliases specified outside of `node_modules` will affect assets inside of `node_modules`.
3. Aliases cannot build off of other aliases.
4. Only one alias will be applied at a time.
5. Aliases must be valid npm package names.

## Plugins

### Resolvers

When one asset depends on another through an asset specifier, the resolver is
responsible for determining what asset is being requested.

See [Asset Resolution](#asset-resolution) for more details.

```json
{
  "resolvers": ["@parcel/resolver-v1"]
}
```

**Official Resolvers:**

- `@parcel/resolver-v1`

### Transforms

Transforms _transform_ single assets as they are discovered and added to the
asset graph. They mostly call out to different compilers and preprocessors.

```json
{
  "transforms": {
    "*.js": ["@parcel/transform-babel"]
  }
}
```

**Official Transforms:**

- `@parcel/transform-babel`
- `@parcel/transform-coffeescript`
- `@parcel/transform-graphql`
- `@parcel/transform-json`
- `@parcel/transform-json5`
- `@parcel/transform-less`
- `@parcel/transform-posthtml`
- `@parcel/transform-postcss`
- `@parcel/transform-pug`
- `@parcel/transform-raw`
- `@parcel/transform-reason`
- `@parcel/transform-rust`
- `@parcel/transform-stylus`
- `@parcel/transform-toml`
- `@parcel/transform-typescript`
- `@parcel/transform-vue`
- `@parcel/transform-wasm`
- `@parcel/transform-webmanifest`
- `@parcel/transform-yaml`
- ...

### Bundlers

Bundlers accept the entire asset graph and turn it into sets of bundles.


```json
{
  "bundler": "@parcel/bundler-v1"
}
```

**Official Bundlers:**

- `@parcel/bundler-v1`

### Packagers

Packagers determine how to merge different asset types into a single bundle.

```json
{
  "packagers": {
    "*.css": "@parcel/packager-css"
  }
}
```

**Official Packagers:**

- `@parcel/packager-html`
- `@parcel/packager-js`
- `@parcel/packager-css`
- `@parcel/packager-wasm`
- `@parcel/packager-raw`

### Optimizers

Optimizers are similar to transformers, but they accept a bundle instead
of a single asset.

```json
{
  "optimizers": {
    "*.js": ["@parcel/optimizer-terser"],
    "*.css": ["@parcel/optimizer-csso"]
  }
}
```

**Official Optimizers:**

- `@parcel/packager-terser`
- `@parcel/packager-csso`
- [todo]

### Loaders

> Do not confuse these with Webpack "loaders", they are not the same thing.

Loaders get called after the bundler phase and generate an asset which gets
included in the final bundle.

```json
{
  "loaders": {
    "*.wasm": "@parcel/loader-wasm"
  }
}
```

**Official Loaders:**

- `@parcel/loader-js`
- `@parcel/loader-css`
- `@parcel/loader-wasm`
- `@parcel/loader-raw`

### Reporters

Reporters receive events as they happen and can either use the Parcel logger to
output to stdout/stderr or they can return assets to be generated on the file
system.

```json
{
  "reporters": ["@parcel/reporter-pretty", "@parcel/reporter-visualizer"]
}
```

**Official Reporters:**

- `@parcel/reporter-pretty`
- `@parcel/reporter-detailed`
- `@parcel/reporter-graph`
- `@parcel/reporter-visualizer`

## Creating Plugins

### Naming

All plugins must follow a naming system:

|            | Official package           | Community packages        | Private company/scoped team packages   |
| ---------- | -------------------------- | ------------------------- | -------------------------------------- |
| Configs    | `@parcel/config-{name}`    | `parcel-config-{name}`    | `@scope/parcel-config[-{name}]`        |
| Resolvers  | `@parcel/resolver-{name}`  | `parcel-resolver-{name}`  | `@scope/parcel-resolver[-{name}]`      |
| Transforms | `@parcel/transform-{name}` | `parcel-transform-{name}` | `@scope/parcel-transform[-{name}]`     |
| Loaders    | `@parcel/loader-{name}`    | `parcel-loader-{name}`    | `@scope/parcel-loader[-{name}]`        |
| Bundlers   | `@parcel/bundler-{name}`   | `parcel-bundler-{name}`   | `@scope/parcel-bundler[-{name}]`       |
| Packagers  | `@parcel/packager-{name}`  | `parcel-packager-{name}`  | `@scope/parcel-packager[-{name}]`      |
| Namers     | `@parcel/namer-{name}`     | `parcel-namer-{name}`     | `@scope/parcel-namer[-{name}]`         |
| Reporters  | `@parcel/reporter-{name}`  | `parcel-reporter-{name}`  | `@scope/parcel-reporter[-{name}]`      |

The `{name}` must be descriptive and directly related to the purpose of the
package. Someone should be able to have an idea of what the package does simply
by reading the name in a `.parcelrc` or `package.json#devDependencies`.

```
parcel-transform-posthtml
parcel-packager-wasm
parcel-reporter-graph-visualizer
```

If your plugin adds support for a specific tool, please use the name of the
tool.

```
parcel-transform-es6 (bad)
parcel-transform-babel (good)
```

If your plugin is a reimplementation of something that exists, try naming it
something that explains why it is a separate:

```
parcel-transform-better-typescript (bad)
parcel-transform-typescript-server (good)
```

We ask that community members work together and when forks happen to try and
resolve them. If someone made a better version of your plugin, please consider
giving the better package name over, have them make a major version bump, and
redirect people to the new tool.

### Versioning

You must follow semantic versioning (to the best of your ability). No, it's not
the perfect system, but it's the best one we have and people do depend on it.

If plugin authors intentionally don't follow semantic versioning, Parcel may
start warning users that they should be locking down the version number for
your plugin.

> Warning: The plugin "parcel-transform-typescript" does not follow semantic
> versioning. You should lock the version range down so your code does not
> break when they make changes. Please upvote this issue to encourage them to
> follow semver: https://github.com/user/parcel-transform-typescript/issues/43

### Engines

You must specify a `package.json#engines.parcel` field with the version range
of Parcel that your plugin supports:

```json
{
  "name": "parcel-transform-imagemin"
  "engines": {
    "parcel": "2.x"
  }
}
```

If you do not specify this field, Parcel will output a warning:

```
Warning: The plugin "parcel-transform-typescript" needs to specify a `package.json#engines.parcel` field with the supported Parcel version range.
```

If you do specify the parcel engine field and the user is using an incompatible
version of Parcel, they will see an error:

```
Error: The plugin "parcel-transform-typescript" is not compatible with the
current version of Parcel. Requires "2.x" but the current version is "3.1.4"
```

Parcel uses node-semver to match version ranges.

## Plugin APIs

There are several different types of plugins. They all look very similar, but
are kept separate so we can have strict contracts one what each one is allowed
to do.

There are some rules that should be followed across every type of plugin:

- **Stateless** — Avoid any kind of state, it will likely be the source of bugs
  for your users. For example, the same transform may exist in multiple
  separate workers which are not allowed to communicate with one another, state
  will not work as expected.
- **Pure** — Given the same input, a plugin must produce the same output, and
  you must not have any observable side effects, or implicit dependencies.
  Otherwise Parcel's caching will break and your users will be sad. You should
  never have to tell users to delete their caches.

The plugin APIs all follow a common shape:

```js
import { NameOfPluginType } from '@parcel/plugin';

export default new NameOfPluginType({
  async methodName(opts: JSONObject): Promise<JSONObject> {
    return result;
  },
});
```

They are made up of modules with well-known named exports of async functions
that:

- Accept a strictly validated JSON-serializable `opts` object.
- Return a strictly validated JSON-serializable `vals` object.

If something you need is not being passed through `opts`, please come talk to
the Parcel team about it. Avoid trying to get information yourself from other
sources, especially from the file system.

### Resolvers

Resolvers get called with an asset request (consisting of a source file path
and the specifier of what is being requested) which it then attempts to
resolve. If the resolver isn't sure how to handle a request, it can also return
`null` and pass it to the next resolver in the chain.

```js
import { Resolver } from '@parcel/plugin';

export default new Resolver({
  async resolve({ assetRequest }) {
    // ...
    return { filePath } || null;
  },
});
```

### Transforms

Transforms _transform_ single assets as they are discovered and added to the
asset graph. They mostly call out to different compilers and preprocessors.

```js
import { Transform } from '@parcel/plugin';

export default new Transform({
  async config({ asset }) {
    // ...
    return { config };
  },

  async parse({ asset }) {
    return { asset, dependencies };
  },

  async transform({ asset }) {
    // ...
    return { assets, dependencies };
  },

  async generate({ asset }) {
    // ...
    return { asset };
  },
});
```

### Bundler

Bundlers accept the entire asset graph and turn it into sets of bundles.

```js
import { Bundler } from '@parcel/plugin';

export default new Bundler({
  async resolve({ graph }) {
    // ...
    return { bundles };
  },
});
```

### Packagers

Packagers determine how to merge different asset types into a single bundle.

```js
import { Packager } from '@parcel/plugin';

export default new Packager({
  async function package({ bundle }) {
    // ...
    return { assets };
  },
});
```

### Optimizers

Optimizers are similar to transformers, but they accept a bundle instead
of a single asset.

```js
import { Optimizer } from '@parcel/plugin';

export default new Optimizer({
  async optimize({ bundle }) {
    // ...
    return { bundle };
  },
});
```

### Loaders

> Do not confuse these with Webpack "loaders", they are not the same thing.

Loaders get called after the bundler phase and generate an asset which gets
included in the final bundle.

```js
import { Loader } from '@parcel/plugin';

export default new Loader({
  async generate(opts) {
    // ...
    return { asset };
  },
});
```

### Reporters

Reporters receive events as they happen and can either use the Parcel logger to
output to stdout/stderr or they can return assets to be generated on the file
system.

```js
import { Reporter } from '@parcel/plugin';

export default new Reporter({
  async report({ event: { type, ... } }) {
    // ...
    return { assets };
  },
});
```
