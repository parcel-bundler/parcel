import worker from './foo.worker';

let instance = worker();

(async function() {
  console.log(await instance.foo());
})();
