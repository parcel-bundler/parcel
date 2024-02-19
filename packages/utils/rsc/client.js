import React from 'react';
import ReactServerDOMReader from 'react-server-dom-parcel/client';

const encoder = new TextEncoder();
let streamController;
const readable = new ReadableStream({
  start(controller) {
    if (typeof window === 'undefined') {
      return;
    }
    for (let chunk of window.__FLIGHT_DATA || []) {
      controller.enqueue(encoder.encode(chunk));
    }
    streamController = controller;
    window.__FLIGHT_DATA.push = (chunk) => {
      controller.enqueue(encoder.encode(chunk));
    };
  },
});

if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    streamController?.close();
  });
} else {
  streamController?.close();
}

let data;
export function Content() {
  data ??= ReactServerDOMReader.createFromReadableStream(
    readable
  );
  return React.use(data);
}
