var x = {a: 'a', b: 'b'};
var {a: y, ...ys} = x;
var z = {y, ...ys};

export default function () {
  return {x, y, z, ys};
}
