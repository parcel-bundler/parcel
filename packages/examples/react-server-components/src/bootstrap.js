import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactServerDOMReader from 'react-server-dom-parcel/client';

const encoder = new TextEncoder();
let streamController;
const readable = new ReadableStream({
  start(controller) {
    for (let chunk of window.__FLIGHT_DATA || []) {
      controller.enqueue(encoder.encode(chunk));
    }
    console.log('queued')
    streamController = controller;
    window.__FLIGHT_DATA.push = (chunk) => {
      controller.enqueue(encoder.encode(chunk));
    };
  },
});

console.log(document.readyState, streamController);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    streamController?.close();
  });
} else {
  streamController?.close();
}

console.log(readable, React)
let data;
function Content() {
  data ??= ReactServerDOMReader.createFromReadableStream(
    readable
  );
  return React.use(data);
}

React.startTransition(() => {
  ReactDOM.hydrateRoot(document, <Content />);
});
