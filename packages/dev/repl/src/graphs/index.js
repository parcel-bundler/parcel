import {wrap} from 'comlink';

let worker;

export default () =>
  (worker =
    worker ||
    wrap(new Worker('./worker.js', {name: 'Parcel Graph Renderer'})).render);
