// @flow
import {Dependency, Symbol, debug} from '@parcel/rust';

describe.only('db', function () {
  it('should support vectors', function () {
    let dep = new Dependency();
    // let sym = new Symbol();

    dep.specifier = 'test';
    // dep.symbols.push(sym);
    dep.symbols.reserve(2);
    console.log(dep.symbols.capacity)
    dep.symbols.reserve(1);
    console.log(dep.symbols.capacity, dep.symbols.length);
    dep.symbols.reserve(1);
    console.log(dep.symbols.capacity, dep.symbols.length)
    let sym = dep.symbols.get(0);
    sym.exported = 'hi';
    sym.local = 'yo';

    sym = dep.symbols.get(1);
    sym.exported = 'hi2';
    sym.local = 'yo2';

    console.log(dep.specifier, dep.symbols.length, dep.symbols.get(0).exported);
    debug(dep.addr);

    for (let item of dep.symbols) {
      console.log(item)
    }
  });
});
