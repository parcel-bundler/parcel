const Comlink = require('comlink');

const ParcelWorker = Comlink.proxy(new Worker('./ParcelWorker.js'));
const worker = new ParcelWorker();

export default async function bundle(assets, options) {
  return (await worker).bundle(assets, options);
}
