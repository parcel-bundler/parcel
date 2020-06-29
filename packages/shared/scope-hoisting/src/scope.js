// @flow

import * as t from '@babel/types';

export class Scope {
  names: Set<string> = new Set();

  has(name: string) {
    return this.names.has(name);
  }

  add(name: string) {
    this.names.add(name);
  }

  generateUid(name: string = 'temp') {
    name = t
      .toIdentifier(name)
      .replace(/^_+/, '')
      .replace(/[0-9]+$/g, '');

    let uid;
    let i = 0;
    do {
      uid = '_' + name + (i > 1 ? i : '');
      i++;
    } while (this.names.has(uid));

    this.names.add(uid);
    return uid;
  }
}
