---
title: Getting Started - Monorepo
platform: platform
product: parcel
category: devguide
subcategory: learning
guides: tutorials
date: '2021-05-26'
---

{{% warning %}}
The content is under construction as Parcel + Monorepo is built out in the Monorepo.
These also include the manual steps and may be replaced by a tool.
{{% /warning %}}

# Getting Started in the Monorepo

Building frontend services has never been easier with Parcel. Working with Monorepo team, we have provided a quick, self-serviceable way to get your application to prod. In the monorepo with Parcel, you will get Typescript, linting, deploy pipeline, default best practices in configuration, and in good company.

## Step 1: Before you begin

1. Set up your Micro service using the guides | [docs](https://hello.atlassian.net/wiki/spaces/MICROS/pages/169253831/Getting+Started), [cookbooks](https://hello.atlassian.net/wiki/spaces/MICROS/pages/521052324/Cookbooks+for+the+new+Micros+user), [getting to production](https://hello.atlassian.net/wiki/spaces/MICROS/pages/167214156/Done+for+Micros)

2. Create your service in [atlassian-frontend](https://bitbucket.org/atlassian/atlassian-frontend/src) under `/services` | [monorepo docs](https://developer.atlassian.com/cloud/framework/atlassian-frontend/), [service support docs](https://developer.atlassian.com/cloud/framework/atlassian-frontend/development/05-service-support/)

## Step 2: In your package.json

The following should be similar to the `uip-demo-app` in the monorepo; however, if you do want start from scratch...

1. In your `package.json`, add the following for scripts:

```
"start": "parcel src/index.html",
"build": "parcel build src/index.html",
```

2. Make sure you have the following devDependencies, using the monorepo versions:

```
"@af/parcel-namer-services": "0.1.0",
"@atlaskit/parcel-resolver": "0.1.0",
"@atlassian/parcel": "^2.0.0-frontbucket.74",
```

- `@af/parcel-namer-service` : supports deploying with Bifrost, can remove if not needed.
- `@atlaskit/parcel-resolver` : resolves the monorepo linking for using `atlaskit` components, can remove if not using `atlaskit`.

## Step 3: Creating the basic application

1. Under `/src`, you can have the basic application layouted as such:

`index.html`

```
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="@atlaskit/css-reset/dist/bundle.css"></link>
    </head>
    <body>
        <div id="app"></div>
        <script type="module" src="./index.tsx"></script>
    </body>
</html>
```

**Notes:**

- you will need to add `@atlaskit/css-reset` to your dependencies if you want the reset

`index.tsx`

```
import React from 'react';
import { render } from 'react-dom';
import App from './App';

render(<App />, document.getElementById('app'));
```

`App.tsx`

```
import React from 'react';

const App = () => {
  return (
    <>
      Hello world
    </>
  );
};

export default App;
```
