import { hashString } from "../hash.mjs" with { type: "macro" };
const bar = 'bar';
const object = {foo: bar};
doSomething(bar);
doSomething(object.foo);
doSomething(object);
output = hashString(object.foo);

const object2 = {foo: bar, obj: {}};
doSomething(object2.obj);
output2 = hashString(object2);

const arr = ['foo'];
doSomething(arr);
output3 = hashString(arr[0]);

const object3 = {foo: bar};
doSomething(object3[unknown]);
output4 = hashString(object3);
