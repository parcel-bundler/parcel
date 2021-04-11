import wasmUrl from './addition.as';

WebAssembly.instantiateStreaming(fetch(wasmUrl)).then(({instance}) =>
  console.log(instance.exports.add(40, 2)),
);
