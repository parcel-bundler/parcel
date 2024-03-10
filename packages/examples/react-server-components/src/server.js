import express from 'express';
import {Readable} from 'node:stream';
import { createClientEntry, importServerEntry, requireClient } from '@parcel/macros' with {type: 'macro'};
import {AsyncLocalStorage} from 'node:async_hooks';
import {renderToReadableStream, loadServerAction, decodeReply, decodeAction} from 'react-server-dom-parcel/server.edge';
import {injectRSCPayload} from 'rsc-html-stream/server';

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

let bootstrapResources = createClientEntry('bootstrap.js');

console.log(bootstrapResources)

function getWebRequest(req) {
  let headers = new Headers();
  for (let key in req.headers) {
    let value = req.headers[key];
    const values = Array.isArray(value) ? value : [value]
    for (let v of values) {
      if (typeof v === 'undefined') continue
      if (typeof v === 'number') {
        v = v.toString()
      }

      headers.append(key, v)
    }
  }

  return new Request('http://localhost' + req.url, {
    method: 'POST',
    headers,
    body: Readable.toWeb(req),
    duplex: 'half'
  });
}

app.get('/', async (req, res) => {
  let [{default: App}, resources] = await importServerEntry('./App');
  await render(req, res, <App />, resources);
});

app.get('/files/*', async (req, res) => {
  let [{default: FilePage}, resources] = await importServerEntry('./FilePage');
  await render(req, res, <FilePage file={req.params[0]} />, resources);
});

app.post('/', async (req, res) => {
  let id = req.get('rsc-action-id');
  let request = getWebRequest(req);

  if (id) {
    let action = await loadServerAction(id);
    let body = req.is('multipart/form-data') ? await request.formData() : await request.text();
    let args = await decodeReply(body);
    let result = action.apply(null, args);
    try {
      // Wait for any mutations
      await result;
    } catch (x) {
      // We handle the error on the client
    }

    let [{default: App}, resources] = await importServerEntry('./App');
    await render(req, res, <App />, resources, result);
  } else {
    // Form submitted by browser (progressive enhancement).
    let formData = await request.formData();
    let action = await decodeAction(formData);
    try {
      // Wait for any mutations
      await action();
    } catch (err) {
      // TODO render error page?
    }
    let [{default: App}, resources] = await importServerEntry('./App');
    await render(req, res, <App />, resources);
  }
});

async function render(req, res, component, resources, actionResult) {
  // Render RSC payload.
  let root = [component, ...renderResources(resources)];
  if (actionResult) {
    root = {result: actionResult, root};
  }
  let stream = renderToReadableStream(root);
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
      ...renderResources(bootstrapResources),
    ]);

    let response = htmlStream.pipeThrough(injectRSCPayload(s2));
    Readable.fromWeb(response).pipe(res);
  } else {
    res.set('Content-Type', 'text/x-component');
    Readable.fromWeb(stream).pipe(res);
  }
}

function renderResources(resources) {
  return resources.map(r => {
    if (r.type === 'css') {
      return <link key={r.url} rel="stylesheet" href={r.url} precedence="default" />;
    } else {
      return <script key={r.url} async type="module" src={r.url} />;
    }
  })
}

let server = app.listen(3001);

if (module.hot) {
  module.hot.dispose(() => {
    server.close();
  });

  module.hot.accept();
}
