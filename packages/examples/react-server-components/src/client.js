import * as React from 'react';
import {Suspense} from 'react';
import ReactDOM from 'react-dom/client';
import ReactServerDOMReader from 'react-server-dom-webpack/client';

globalThis.__webpack_chunk_load__ = (c) => __parcel__import__(c);
globalThis.__webpack_require__ = id => parcelRequire(id);

let data = ReactServerDOMReader.createFromFetch(
  fetch('http://localhost:3001'),
);

function Content() {
  return React.use(data);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={<h1>Loading...</h1>}>
    <Content />
  </Suspense>
);
