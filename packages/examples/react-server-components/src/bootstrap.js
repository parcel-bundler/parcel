import {useState, use, startTransition, useInsertionEffect} from 'react';
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
  startTransition(() => {
    updateRoot(root);
  });
  return result;
});

let data;
function Content() {
  data ??= createFromReadableStream(rscStream);
  let [[root, cb], setRoot] = useState([use(data), null]);
  updateRoot = (root, cb) => setRoot([root, cb]);
  useInsertionEffect(() => {
    if (cb) {
      cb();
    }
  });
  return root;
}

async function navigate(pathname, push) {
  let res = fetch(pathname, {
    headers: {
      Accept: 'text/x-component'
    }
  });
  let root = await createFromFetch(res);
  startTransition(() => {
    updateRoot(root, push ? (() => {
      history.pushState(null, '', pathname);
    }) : null);
  });
}

if (typeof document !== 'undefined') {
  startTransition(() => {
    ReactDOM.hydrateRoot(document, <Content />);
  });

  window.addEventListener('parcelhmrreload', e => {
    e.preventDefault();
    navigate(location.pathname);
  });

  document.addEventListener('click', e => {
    let link = e.target.closest('a');
    if (
      link &&
      link instanceof HTMLAnchorElement &&
      link.href &&
      (!link.target || link.target === '_self') &&
      link.origin === location.origin &&
      !link.hasAttribute('download') &&
      e.button === 0 && // left clicks only
      !e.metaKey && // open in new tab (mac)
      !e.ctrlKey && // open in new tab (windows)
      !e.altKey && // download
      !e.shiftKey &&
      !e.defaultPrevented
    ) {
      e.preventDefault();
      navigate(link.pathname, true);
    }
  });

  window.addEventListener('popstate', e => {
    navigate(location.pathname);
  });
}
