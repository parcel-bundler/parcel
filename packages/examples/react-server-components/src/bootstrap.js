import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactServerDOMReader from 'react-server-dom-parcel/client';
import {rscStream} from 'rsc-html-stream/client';

let data;
function Content() {
  data ??= ReactServerDOMReader.createFromReadableStream(
    rscStream
  );
  return React.use(data);
}

if (typeof document !== 'undefined') {
  React.startTransition(() => {
    ReactDOM.hydrateRoot(document, <Content />);
  });
}
