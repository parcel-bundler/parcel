import express from 'express';
import React from 'react';
import ReactDOM from 'react-dom';
import {renderToReadableStream} from 'react-server-dom-parcel/server.browser';
import {Readable} from 'node:stream';
import {manifest} from '@parcel/rsc-manifest';
import {addDependency} from './macro' with {type: 'macro'};
import {AsyncLocalStorage} from 'node:async_hooks';

globalThis.AsyncLocalStorage = AsyncLocalStorage;

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

// import App from './App';
app.get('/ssr', async (req, res) => {
  const {default: App} = (await import('./App'));
  const {createFromReadableStream, renderHTMLToReadableStream, ReactClient} = (await import('./serverClient', {context: 'browser'}));

  console.log(bootstrap)
  
  const stream = renderToReadableStream(
    <App />,
    manifest,
  );

  const [s1, s2] = stream.tee();
  let data;
  function Content() {
    data ??= createFromReadableStream(s1, {
      ssrManifest: {
        moduleMap: null,
        moduleLoading: {
          prefix: ''
        }
      }
    });
    return ReactClient.use(data);
  }

  // let flight = await streamToString(s2);
  // console.log(flight)

  const response = await renderHTMLToReadableStream([
    <Content />,
    ...bootstrap.map(url => <script type="module" src={url.split('/').pop()} async />),
  ], {
    // bootstrapScriptContent: `window.__FLIGHT_DATA = ${JSON.stringify(flight)}`,
  });

  let encoder = new TextEncoder();
  let decoder = new TextDecoder();
  let reader = s2.getReader();
  let resolveFlightDataPromise;
  let flightDataPromise = new Promise((resolve) => resolveFlightDataPromise = resolve);
  let started = false;
  let transform = new TransformStream({
    transform(chunk, controller) {
      if (!started) {
        started = true;
        process.nextTick(async () => {
          while (true) {
            let {done, value} = await reader.read();
            if (done) {
              resolveFlightDataPromise();
              return;
            }
            // TODO: escape
            controller.enqueue(encoder.encode(`<script>(self.__FLIGHT_DATA||=[]).push(${JSON.stringify(decoder.decode(value))})</script>`));
          }
        });
      }
    
      let buf = decoder.decode(chunk);
      controller.enqueue(encoder.encode(buf.replace('</body></html>', '')));
    },
    async flush(controller) {
      await flightDataPromise;
      controller.enqueue(encoder.encode('</body></html>'));
    }
  });
  
  res.setHeader('content-type', 'text/html');
  Readable.fromWeb(response.pipeThrough(transform)).pipe(res);
  // console.log('wrote')
});

async function streamToString(stream) {
  let s = '';
  for await (let chunk of stream.pipeThrough(new TextDecoderStream())) {
    s += chunk
  }
  return s;
}

app.listen(3001);
