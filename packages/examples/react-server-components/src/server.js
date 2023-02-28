import express from 'express';
import React from 'react';
import {renderToPipeableStream} from 'react-server-dom-webpack/server.node';
import {renderToReadableStream} from 'react-server-dom-webpack/server.browser';
import {createFromReadableStream} from 'react-server-dom-webpack/client.browser';
import {renderToReadableStream as renderHTMLToReadableStream} from 'react-dom/server.browser';
import {Readable} from 'node:stream';
import {manifest} from '@parcel/rsc-manifest';

const app = express();

app.options('/', function (req, res) {
  res.setHeader('Allow', 'Allow: GET,HEAD,POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'rsc-action');
  res.end();
});

app.get('/', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const App = (await import('./App')).default;
  const {pipe} = renderToPipeableStream(
    React.createElement(App),
    manifest,
  );
  pipe(res);
});

globalThis.__webpack_chunk_load__ = (c) => __parcel__import__('.' + c);
globalThis.__webpack_require__ = id => parcelRequire(id);

app.get('/ssr', async (req, res) => {
  const App = (await import('./App')).default;

  const stream = renderToReadableStream(
    React.createElement(App),
    manifest,
  );
  const [s1, s2] = stream.tee();
  const data = createFromReadableStream(s1);
  function Content() {
    return React.use(data);
  }

  let flight = await streamToString(s2);
  console.log(flight)

  const response = await renderHTMLToReadableStream(<Content />, {
    bootstrapScriptContent: `window.__FLIGHT_DATA = ${JSON.stringify(flight)}`,
    // TODO: also get a list of all scripts needed to render the component and preload them.
    bootstrapScripts: ['http://localhost:8080/' + new URL('bootstrap.js', import.meta.url).pathname.split('/').pop()]
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
