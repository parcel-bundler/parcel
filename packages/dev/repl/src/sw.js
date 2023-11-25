/* eslint-disable no-restricted-globals */
// @flow strict

import nullthrows from 'nullthrows';

let isSafari =
  /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
let lastHMRStream;

type ClientId = string;
type ParentId = string;

let sendToIFrame = new Map<ClientId, (data: string) => void>();
let pages = new Map<ParentId, {|[string]: string|}>();
let parentPorts = new Map<ParentId, MessagePort>();
let parentToIframe = new Map<ParentId, ClientId>();
let iframeToParent = new Map<ClientId, ParentId>();

global.parentPorts = parentPorts;
global.parentToIframe = parentToIframe;
global.iframeToParent = iframeToParent;

const SECURITY_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const MIME = new Map([
  ['html', 'text/html'],
  ['js', 'text/javascript'],
  ['css', 'text/css'],
]);

// // TODO figure out which script is the entry
// function htmlWrapperForJS(script) {
//   return `<script type="application/javascript">
// window.console = {
//   log: function() {
//     var content = Array.from(arguments)
//       .map(v => (typeof v === "object" ? JSON.stringify(v) : v))
//       .join(" ");
//     document
//       .getElementById("output")
//       .appendChild(document.createTextNode(content + "\\n"));
//   },
//   warn: function() {
//     console.log.apply(console, arguments);
//   },
//   info: function() {
//     console.log.apply(console, arguments);
//   },
//   error: function() {
//     console.log.apply(console, arguments);
//   }
// };
// window.onerror = function(e) {
//   console.error(e.message);
//   console.error(e.stack);
// }
// </script>
// <body>
// Console output:<br>
// <div id="output" style="font-family: monospace;white-space: pre-wrap;"></div>
// </body>
// <script type="application/javascript">
// // try{
// ${script}
// // } catch(e){
// //   console.error(e.message);
// //   console.error(e.stack);
// // }
// </script>`;
// }

// listen here instead of attaching temporary 'message' event listeners to self
let messageProxy = new EventTarget();

self.addEventListener('message', evt => {
  let parentId = evt.source.id;
  let {type, data, id} = evt.data;
  if (type === 'setFS') {
    // called by worker
    evt.source.postMessage({id});
    pages.set(parentId, data);
  } else if (type === 'getID') {
    evt.source.postMessage({id, data: parentId});
  } else if (type === 'hmrUpdate') {
    // called by worker
    parentPorts.set(parentId, evt.source);
    let clientId = parentToIframe.get(parentId);
    let send =
      (clientId != null ? sendToIFrame.get(clientId) : null) ?? lastHMRStream;
    send?.(data);
    evt.source.postMessage({id});
  } else {
    let wrapper = new Event(evt.type);
    // $FlowFixMe
    wrapper.data = evt.data;
    messageProxy.dispatchEvent(wrapper);
  }
});

let encodeUTF8 = new TextEncoder();

self.addEventListener('fetch', evt => {
  let url = new URL(evt.request.url);
  let {clientId} = evt;
  let parentId;
  if (!clientId && url.searchParams.has('parentId')) {
    clientId = evt.resultingClientId ?? evt.targetClientId;
    parentId = nullthrows(url.searchParams.get('parentId'));
    parentToIframe.set(parentId, clientId);
    iframeToParent.set(clientId, parentId);
  } else {
    parentId = iframeToParent.get(evt.clientId);
  }
  if (parentId == null && isSafari) {
    parentId = [...pages.keys()].slice(-1)[0];
  }

  if (parentId != null) {
    if (
      evt.request.headers.get('Accept') === 'text/event-stream' &&
      url.pathname === '/__parcel_hmr'
    ) {
      let stream = new ReadableStream({
        start: controller => {
          let cb = data => {
            let chunk = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encodeUTF8.encode(chunk));
          };
          sendToIFrame.set(clientId, cb);
          lastHMRStream = cb;
        },
      });

      evt.respondWith(
        new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Transfer-Encoding': 'chunked',
            Connection: 'keep-alive',
            ...SECURITY_HEADERS,
          },
        }),
      );
    } else if (url.pathname.startsWith('/__parcel_hmr/')) {
      evt.respondWith(
        (async () => {
          let port = parentId != null ? parentPorts.get(parentId) : null;

          if (port == null) {
            return new Response(null, {status: 500});
          }

          let [type, content] = await sendMsg(
            port,
            'hmrAssetSource',
            url.pathname.slice('/__parcel_hmr/'.length),
          );
          return new Response(content, {
            headers: {
              'Content-Type':
                (MIME.get(type) ?? 'application/octet-stream') +
                '; charset=utf-8',
              'Cache-Control': 'no-store',
              ...SECURITY_HEADERS,
            },
          });
        })(),
      );
    } else if (url.pathname.startsWith('/__repl_dist/')) {
      let filename = url.pathname.slice('/__repl_dist/'.length);
      let file = pages.get(parentId)?.[filename];
      if (file == null) {
        console.error('requested missing file', parentId, filename, pages);
      }

      evt.respondWith(
        new Response(file, {
          headers: {
            'Content-Type':
              (MIME.get(extname(filename)) ?? 'application/octet-stream') +
              '; charset=utf-8',
            'Cache-Control': 'no-store',
            ...SECURITY_HEADERS,
          },
        }),
      );
    }
  }
});

function extname(filename) {
  return filename.slice(filename.lastIndexOf('.') + 1);
}

function removeNonExistingKeys(existing, map) {
  for (let id of map.keys()) {
    if (!existing.has(id)) {
      map.delete(id);
    }
  }
}
setInterval(async () => {
  let existingClients = new Set((await self.clients.matchAll()).map(c => c.id));

  removeNonExistingKeys(existingClients, pages);
  removeNonExistingKeys(existingClients, sendToIFrame);
  removeNonExistingKeys(existingClients, parentToIframe);
  removeNonExistingKeys(existingClients, iframeToParent);
}, 20000);

function sendMsg(target, type, data, transfer) {
  let id = uuidv4();
  return new Promise(res => {
    let handler = (evt: MessageEvent) => {
      // $FlowFixMe
      if (evt.data.id === id) {
        messageProxy.removeEventListener('message', handler);
        // $FlowFixMe
        res(evt.data.data);
      }
    };
    messageProxy.addEventListener('message', handler);
    target.postMessage({type, data, id}, transfer);
  });
}
function uuidv4() {
  return (String(1e7) + -1e3 + -4e3 + -8e3 + -1e11).replace(
    /[018]/g,
    // $FlowFixMe
    (c: number) =>
      (
        c ^
        // $FlowFixMe
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16),
  );
}
