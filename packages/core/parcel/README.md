# Atlaspack

[![Atlassian license](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
<!-- [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md) -->

Atlaspack is the frontend bundler used to build Atlassian products, written in JavaScript and Rust by core contributors of [Parcel](https://github.com/parcel-bundler/parcel). It has been engineered to bundle exceptionally large applications and serve the needs of our products. While you are welcome to try out atlaspack, we do not plan to support use-cases outside of Atlassian at this time. Therefore, we advise against using atlaspack in production environments.

> [!NOTE]
> This repository is currently a direct fork of [Parcel](https://github.com/parcel-bundler/parcel) that will diverge over time to better handle the needs and scale required by Atlassian

Special thanks to [Devon](https://github.com/devongovett) for his invaluable contributions, guidance, and wisdom in shaping the foundations of the Atlassian bundler!

## Prerequisites

- [Node](https://nodejs.org) LTS
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- [Yarn](https://yarnpkg.com) v1

## Installation

```sh
npm install --save-dev atlaspack
```

## Usage

```sh
atlaspack src/index.html
```

---

src/index.html
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>Atlaspack App</title>
    <script type="module" src="app.js"></script>
  </head>
  <body>
    <h1>Hello, World!</h1>
  </body>
</html>
```

---

src/app.js
```js
console.log('Hello, World!');
```

## Documentation

Check the [docs website](https://parceljs.org) or the [docs](https://github.com/atlassian-labs/atlaspack/tree/main/docs) folder.

## Tests

```sh
yarn test
```

## Contributions

<!-- Contributions to [Project name] are welcome!-->

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details. 

## License

Copyright (c) 2024 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

<br/> 

[![With â¤ï¸ from Atlassian](https://raw.githubusercontent.com/atlassian-internal/oss-assets/master/banner-cheers-light.png)](https://www.atlassian.com)
