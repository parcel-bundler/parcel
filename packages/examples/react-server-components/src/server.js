import express from 'express';
import {Readable} from 'node:stream';
import {addDependency} from './macro' with {type: 'macro'};
import {AsyncLocalStorage} from 'node:async_hooks';
import {renderRSCPayload, renderHTML} from '@parcel/rsc';

globalThis.AsyncLocalStorage = AsyncLocalStorage;

const app = express();

app.options('/', function (req, res) {
  res.setHeader('Allow', 'Allow: GET,HEAD,POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'rsc-action');
  res.end();
});

app.use(express.static('dist'));

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

app.get('/ssr', async (req, res) => {
  const {default: App} = await import('./App');

  let stream = renderRSCPayload(<App />);
  if (req.accepts('text/html')) {
    res.setHeader('Content-Type', 'text/html');
    Readable.fromWeb(await renderHTML(stream, bootstrap)).pipe(res);  
  } else {
    res.set('Content-Type', 'text/x-component');
    Readable.fromWeb(stream).pipe(res);
  }
});

app.listen(3001);
