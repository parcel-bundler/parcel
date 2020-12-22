// @flow
import type {Assets, REPLOptions} from '../utils';
import type {BundleOutput} from './ParcelWorker';

import {proxy, wrap, transfer} from 'comlink';

const worker = wrap(
  new Worker('./ParcelWorker.js', {name: 'Parcel Worker Main'}),
);

// const worker = {
//   ready: Promise.resolve(),
//   bundle(assets, options): Promise<BundleOutput> {
//     return Promise.resolve({
//       type: 'success',
//       bundles: assets.map(({name, content}) => ({
//         name,
//         content,
//         time: 0,
//         size: content.length,
//       })),
//       buildTime: 1,
//       graphs: options.renderGraphs
//         ? [
//             {
//               name: 'test',
//               content: `digraph graphname
// {
//     a -> b -> c;
//     b -> d;
// }`,
//             },
//           ]
//         : null,
//       sourcemaps: null,
//     });
//   },
// };

export const workerReady: Promise<void> = worker.ready;

export function waitForFS(): Promise<void> {
  return worker.waitForFS();
}

export function bundle(
  assets: Assets,
  options: REPLOptions,
  progress: string => void,
): Promise<BundleOutput> {
  return worker.bundle(assets, options, proxy(progress));
}

export function watch(
  assets: Assets,
  options: REPLOptions,
  onBuild: BundleOutput => void,
  progress: (?string) => void,
): Promise<{|
  unsubscribe: () => Promise<mixed>,
  writeAssets: Assets => Promise<mixed>,
|}> {
  return worker.watch(assets, options, proxy(onBuild), proxy(progress));
}

class MessageTarget {
  receive: any;
  post: any;
  constructor(receive: any, post: any) {
    this.receive = receive;
    this.post = post;
  }
  postMessage(...args) {
    this.post.postMessage(...args);
  }
  addEventListener(...args) {
    // $FlowFixMe
    this.receive.addEventListener(...args);
  }
  removeEventListener(...args) {
    // $FlowFixMe
    this.receive.removeEventListener(...args);
  }
  sendMsg(type, data, transfer) {
    let id = uuidv4();
    return new Promise(res => {
      let handler = evt => {
        if (evt.data.id === id) {
          this.removeEventListener('message', handler);
          res(evt.data.data);
        }
      };
      this.addEventListener('message', handler);
      this.postMessage({type, data, id}, transfer);
    });
  }
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

export let clientID: Promise<string>;

if (navigator.serviceWorker) {
  clientID = (async () => {
    // $FlowFixMe
    let {active: serviceWorker} = await navigator.serviceWorker.ready;

    let sw = new MessageTarget(navigator.serviceWorker, serviceWorker);

    let {port1, port2} = new MessageChannel();

    sw.addEventListener('message', evt => {
      port2.postMessage(evt.data);
    });
    port2.addEventListener('message', (evt: MessageEvent) => {
      sw.postMessage(evt.data);
    });

    port2.start();
    await worker.setServiceWorker(transfer(port1, port1));

    return sw.sendMsg('getID');
  })();
}
