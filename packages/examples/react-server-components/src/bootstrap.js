import './env';
import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactServerDOMReader from 'react-server-dom-webpack/client';

// globalThis.__webpack_chunk_load__ = (c) => __parcel__import__('http://localhost:8080' + c);
// globalThis.__webpack_require__ = id => parcelRequire(id);

const encoder = new TextEncoder();
const readable = new ReadableStream({
  start(controller) {
    console.log(controller, window.__FLIGHT_DATA)
    controller.enqueue(encoder.encode(window.__FLIGHT_DATA));
    controller.close();
  },
})

console.log(readable, React)
let data = ReactServerDOMReader.createFromReadableStream(
  readable
);

function Content() {
  return React.use(data);
}

ReactDOM.hydrateRoot(document, <Content />);