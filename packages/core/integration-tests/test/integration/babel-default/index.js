import Foo from './foo';

class Bar {}

// Make sure that scope hoisting retains these variables
output = {Foo, Bar};
