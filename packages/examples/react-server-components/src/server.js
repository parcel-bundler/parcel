import './env';
import express from 'express';
import React from 'react';
// import ReactClient
// import {renderToPipeableStream} from 'react-server-dom-webpack/server.node' with {condition: 'react-server'};
import {renderToReadableStream} from 'react-server-dom-webpack/server.browser';
// import {createFromReadableStream} from 'react-server-dom-webpack/client.browser';
// import {renderToReadableStream as renderHTMLToReadableStream} from 'react-dom/server.browser';
import {Readable} from 'node:stream';
import {manifest} from '@parcel/rsc-manifest';
import {addDependency} from './macro' with {type: 'macro'};

const app = express();

app.options('/', function (req, res) {
  res.setHeader('Allow', 'Allow: GET,HEAD,POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'rsc-action');
  res.end();
});

app.use(express.static('dist'));

// app.get('/', async (req, res) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   const App = (await import('./App')).default;
//   const {pipe} = renderToPipeableStream(
//     React.createElement(App),
//     manifest,
//   );
//   pipe(res);
// });

app.get('/ssr', async (req, res) => {
  let bootstrap = addDependency({
    specifier: 'bootstrap.js',
    specifierType: 'url',
    priority: 'parallel',
    // bundleBehavior: 'isolated',
    env: {
      context: 'browser',
      outputFormat: 'esmodule',
      includeNodeModules: true
    }
  })();
  const App = (await import('./App')).default;
  const {createFromReadableStream, renderHTMLToReadableStream, ReactClient} = (await import('./serverClient', {context: 'browser'}));

  const stream = renderToReadableStream(
    React.createElement(App),
    manifest,
  );
  const [s1, s2] = stream.tee();
  const data = createFromReadableStream(s1);
  function Content() {
    return ReactClient.use(data);
  }

  let flight = await streamToString(s2);
  console.log(flight)

  const response = await renderHTMLToReadableStream(<Content />, {
    bootstrapScriptContent: `window.__FLIGHT_DATA = ${JSON.stringify(flight)}`,
    // TODO: also get a list of all scripts needed to render the component and preload them.
    bootstrapModules: bootstrap.map(url => url.split('/').pop())
  });
  
  res.setHeader('content-type', 'text/html');
  for await (let chunk of response) {
    res.write(chunk);
  }

  res.end();
});

async function streamToString(stream) {
  let s = '';
  for await (let chunk of stream.pipeThrough(new TextDecoderStream())) {
    s += chunk
  }
  return s;
}

app.listen(3001);
