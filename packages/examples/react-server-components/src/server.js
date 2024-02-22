import express from 'express';
import {Readable} from 'node:stream';
import { createBootstrapScript, importServerComponent, requireClient } from '@parcel/rsc/macro' with {type: 'macro'};
import {AsyncLocalStorage} from 'node:async_hooks';
import {renderToReadableStream, decodeReply} from 'react-server-dom-parcel/server.edge';
import {injectRSCPayload} from 'rsc-html-stream/server';
import bodyParser from 'body-parser';

const {createFromReadableStream} = requireClient('react-server-dom-parcel/client.edge');
const {renderToReadableStream: renderHTMLToReadableStream} = requireClient('react-dom/server.edge');
const ReactClient = requireClient('react');

globalThis.AsyncLocalStorage = AsyncLocalStorage;

const app = express();

app.options('/', function (req, res) {
  res.setHeader('Allow', 'Allow: GET,HEAD,POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'rsc-action');
  res.end();
});

app.use(express.static('dist'));

let bootstrap = createBootstrapScript('bootstrap.js');

console.log(bootstrap)

app.get('/', async (req, res) => {
  let [{default: App}, resources] = await importServerComponent('./App');
  
  // Render RSC payload.
  let stream = renderToReadableStream([<App />, ...renderResources(resources)]);
  if (req.accepts('text/html')) {
    res.setHeader('Content-Type', 'text/html');

    // Use client react to render the RSC payload to HTML.
    let [s1, s2] = stream.tee();
    let data;
    function Content() {
      data ??= createFromReadableStream(s1);
      return ReactClient.use(data);
    }

    let htmlStream = await renderHTMLToReadableStream([
      <Content />,
      ...renderResources(bootstrap),
    ]);

    let response = htmlStream.pipeThrough(injectRSCPayload(s2));
    Readable.fromWeb(response).pipe(res);  
  } else {
    res.set('Content-Type', 'text/x-component');
    Readable.fromWeb(stream).pipe(res);
  }
});

app.post('/', bodyParser.text(), async (req, res) => {
  let id = req.get('rsc-action-id');
  let name = req.get('rsc-action-name');
  if (!id || !name) {
    throw new Error('Invalid action');
  }

  // TODO: verify that this is a valid action?
  let action = parcelRequire(id)[name];
  console.log(id, name, action);
  if (typeof action !== 'function') {
    throw new Error('Invalid action');
  }
  
  console.log(req.body)
  let args = await decodeReply(req.body);
  let result = action.apply(null, args);
  try {
    // Wait for any mutations
    await result;
  } catch (x) {
    // We handle the error on the client
  }

  let [{default: App}, resources] = await importServerComponent('./App');
  let stream = renderToReadableStream({result, root: [<App />, ...renderResources(resources)]});
  res.set('Content-Type', 'text/x-component');
  Readable.fromWeb(stream).pipe(res);
});

function renderResources(resources) {
  return resources.map(r => {
    if (r.type === 'css') {
      return <link key={r.url} rel="stylesheet" href={r.url} precedence="default" />;
    } else {
      return <script key={r.url} async type="module" src={r.url} />;
    }
  })
}

app.listen(3001);
