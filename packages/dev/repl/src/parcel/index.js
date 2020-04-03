// @flow
import type {Assets, REPLOptions} from '../utils';
import type {BundleOutput} from './ParcelWorker';

import {wrap} from 'comlink';

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

export function bundle(
  assets: Assets,
  options: REPLOptions,
): Promise<BundleOutput> {
  return worker.bundle(assets, options);
}
