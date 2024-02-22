import {useState, use, startTransition} from 'react';
import ReactDOM from 'react-dom/client';
import {createFromReadableStream, createFromFetch, encodeReply} from 'react-server-dom-parcel/client';
import {rscStream} from 'rsc-html-stream/client';

let updateRoot;
async function callServer([id, name], args) {
  console.log(id, args)
  const response = fetch('/', {
    method: 'POST',
    headers: {
      Accept: 'text/x-component',
      'rsc-action-id': id,
      'rsc-action-name': name,
    },
    body: await encodeReply(args),
  });
  const {result, root} = await createFromFetch(response, {callServer});
  // startTransition(() => {
    updateRoot(root);
  // });
  return result;
}

let data;
function Content() {
  data ??= createFromReadableStream(
    rscStream,
    {callServer}
  );
  let [root, setRoot] = useState(use(data));
  updateRoot = setRoot;
  return root;
}

if (typeof document !== 'undefined') {
  startTransition(() => {
    ReactDOM.hydrateRoot(document, <Content />);
  });
}
