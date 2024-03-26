// @flow
import {wrap} from 'comlink';

let worker;

export default (() =>
  (worker =
    worker ??
    wrap(
      // $FlowFixMe
      new Worker(new URL('./worker.js', import /*:: ("") */.meta.url), {
        name: 'Parcel Graph Renderer',
        type: 'module',
      }),
    ).render): () => Promise<(dot: string) => Promise<string>>);
