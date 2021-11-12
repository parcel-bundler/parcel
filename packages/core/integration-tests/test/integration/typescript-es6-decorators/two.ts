import {ClassOne} from './one';

function decorator() {
}

export class ClassTwo {
  @decorator(ClassOne)
  one?: ClassOne;
}
