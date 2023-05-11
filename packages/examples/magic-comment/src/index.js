import './index-other.js';

console.log(import(/* webpackChunkName: "my-chunk-name" */ './foo1'));
console.log(import(/* webpackChunkName: "my-chunk-name" */ './foo2'));
console.log(
  import(
    /* something */ /* webpackChunkName: "my-third-chunk-name" */ /* else */ './foo3'
  ),
);
