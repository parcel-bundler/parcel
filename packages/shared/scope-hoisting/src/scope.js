// @flow

import type {Identifier, Node} from '@babel/types';
import * as t from '@babel/types';

export class Scope {
  names: Set<string> = new Set();
  bindings: Map<string, Node> = new Map();
  references: Map<string, Set<Identifier>> = new Map();
  parent: ?Scope;
  renames: Map<string, string> = new Map();
  inverseRenames: Map<string, string> = new Map();

  constructor(parent: ?Scope) {
    this.parent = parent;
  }

  has(name: string) {
    if (this.names.has(name)) {
      return true;
    }

    if (this.parent) {
      return this.parent.has(name);
    }

    return false;
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

  getRoot() {
    if (this.parent) {
      return this.parent.getRoot();
    }

    return this;
  }

  addBinding(name: string, decl: Node) {
    this.names.add(name);
    this.bindings.set(name, decl);
  }

  getBinding(name: string) {
    return this.bindings.get(name);
  }

  addReference(identifier: Identifier) {
    let references = this.references.get(identifier.name);
    if (!references) {
      references = new Set();
      this.references.set(identifier.name, references);
    }

    references.add(identifier);
  }

  rename(from: string, to: string) {
    // If already renamed, update the original to the final name.
    let renamed = this.inverseRenames.get(from);
    if (renamed) {
      this.renames.set(renamed, to);
    } else {
      this.renames.set(from, to);
      this.inverseRenames.set(to, from);
    }
  }

  exit() {
    // Rename declarations in this scope.
    for (let [from, to] of this.renames) {
      if (!this.names.has(from) && this.parent) {
        this.parent.rename(from, to);
      }

      let references = this.references.get(from);
      if (!references) {
        continue;
      }

      for (let id of references) {
        id.name = to;
      }
    }

    // Propagate unknown references to the parent scope.
    let parent = this.parent;
    if (parent) {
      for (let [name, ids] of this.references) {
        if (!this.names.has(name)) {
          for (let id of ids) {
            parent.addReference(id);
          }
        }
      }
    }
  }
}
