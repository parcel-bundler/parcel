this.foo = 5;

class X {
  constructor() {
    this.bar = 2;
  }
  x() {
    this.bar = 2;
  }
}

function f() {
  this.bar = 2;
}

if (Date.now() > 0) {
  this.foo += 1;
}

new f();
new X().x();


eval('this.foobar = 4');
