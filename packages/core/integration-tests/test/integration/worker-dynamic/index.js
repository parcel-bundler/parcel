let worker = new Worker(new URL('worker.js', import.meta.url), {type: 'module'});
export default new Promise(resolve => {
  worker.addEventListener('message', resolve);
});
