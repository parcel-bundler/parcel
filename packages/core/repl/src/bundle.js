const Comlink = require('comlink');

const ParcelWorker = Comlink.proxy(new Worker('./ParcelWorker.js'));
export const workerLoaded = new ParcelWorker();

export default async function bundle(assets, options) {
  return (await workerLoaded).bundle(assets, options);
}
