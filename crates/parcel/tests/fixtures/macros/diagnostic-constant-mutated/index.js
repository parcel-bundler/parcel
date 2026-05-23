import { hashString } from "../hash.mjs" with { type: "macro" };
const object = {foo: 'bar'};
object.foo = 'test';
output = hashString(object.foo);

const arr = ['foo'];
arr[0] = 'bar';
output = hashString(arr[0]);
