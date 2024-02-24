import {useState, use, startTransition} from 'react';
import ReactDOM from 'react-dom/client';
import {createFromReadableStream, createFromFetch, encodeReply, setServerCallback} from 'react-server-dom-parcel/client';
import {rscStream} from 'rsc-html-stream/client';

let updateRoot;
setServerCallback(async function(id, args) {
  console.log(id, args)
  const response = fetch('/', {
    method: 'POST',
    headers: {
      Accept: 'text/x-component',
      'rsc-action-id': id,
    },
    body: await encodeReply(args),
  });
  const {result, root} = await createFromFetch(response);
  // startTransition(() => {
    updateRoot(root);
  // });
  return result;
});

let data;
function Content() {
  data ??= createFromReadableStream(rscStream);
  let [root, setRoot] = useState(use(data));
  updateRoot = setRoot;
  return root;
}

if (typeof document !== 'undefined') {
  startTransition(() => {
    ReactDOM.hydrateRoot(document, <Content />);
  });
}
