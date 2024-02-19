import {renderToReadableStream} from 'react-server-dom-parcel/server.edge';
import { getClientReact, requireClient } from './macro' with {type: 'macro'};

export function renderRSCPayload(content) {
  return renderToReadableStream(content);
}

export async function renderHTML(stream, bootstrap) {
  // Load React and SSR rendering dependencies in a browser environment.
  // This ensures that React is defined via parcelRequire using the same asset id as
  // client components reference. In addition, client React has different exports than
  // server React (via the react-server package exports condition), and we need to ensure
  // the full React is available when rendering client components.
  const {createFromReadableStream} = requireClient('react-server-dom-parcel/client.edge');
  const {renderToReadableStream: renderHTMLToReadableStream} = requireClient('react-dom/server.edge');
  const ReactClient = requireClient('react');

  const [s1, s2] = stream.tee();
  let data;
  function Content() {
    data ??= createFromReadableStream(s1);
    return ReactClient.use(data);
  }

  const response = await renderHTMLToReadableStream([
    <Content />,
    ...bootstrap.map(r => <script async type="module" src={r.url.split('/').pop()} />),
  ]);

  return response.pipeThrough(createRSCTransformScreen(s2));
}

function createRSCTransformScreen(rscStream) {
  let encoder = new TextEncoder();
  let decoder = new TextDecoder();
  let resolveFlightDataPromise;
  let flightDataPromise = new Promise((resolve) => resolveFlightDataPromise = resolve);
  let started = false;
  return new TransformStream({
    transform(chunk, controller) {    
      let buf = decoder.decode(chunk);
      controller.enqueue(encoder.encode(buf.replace('</body></html>', '')));

      if (!started) {
        started = true;
        process.nextTick(async () => {
          for await (let chunk of rscStream) {
            // TODO: escape
            controller.enqueue(encoder.encode(`<script>(self.__FLIGHT_DATA||=[]).push(${JSON.stringify(decoder.decode(chunk))})</script>`));
          }
          resolveFlightDataPromise();
        });
      }
    },
    async flush(controller) {
      await flightDataPromise;
      controller.enqueue(encoder.encode('</body></html>'));
    }
  });
}
