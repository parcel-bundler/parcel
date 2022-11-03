import {Test as Foo} from './other';
import type {File} from './nested/file';
import * as ns from './namespace';

export function foo(f: Foo) {
  return f.foo;
}

export function file(f: File) {
  return new ns.Message(f.name);
}

export {File};
