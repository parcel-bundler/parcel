import {ClassTwo} from './two';

function decorator() {
}

export class ClassOne {
  @decorator(ClassTwo)
  two?: ClassTwo;
}
