import {wrap as ComlinkWrap} from 'comlink';

const ParcelWorker = ComlinkWrap(new Worker('./ParcelWorker.js'));
export const workerLoaded = new ParcelWorker();

export async function getFS() {
  return (await workerLoaded).getFS();
}

export async function getZip() {
  return (await workerLoaded).getZip();
}

export default async function bundle(assets, options) {
  return (await workerLoaded).bundle(assets, options);
}
