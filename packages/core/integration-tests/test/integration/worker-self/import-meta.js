export function startWorker() {
  new Worker(import.meta.url, {type: 'module'});
}
