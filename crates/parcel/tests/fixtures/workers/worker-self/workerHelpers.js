export function startWorkers() {
  new Worker(new URL('./workerHelpers.js', import.meta.url), {type: 'module'});
}
