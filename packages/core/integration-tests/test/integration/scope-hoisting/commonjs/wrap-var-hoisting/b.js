for(var BigIntSupported in [0, 1]){}
for (var i = 0, len = 100; i < len; ++i) {}

if (BigIntSupported) {
	var bigIntValue = () => true;
  let inner_let = false;
  if (inner_let){
    throw new Error();
  }
}

function testIsHoisted() {
	return BigIntSupported && bigIntValue();
}

const f1 = () => {
  var f1_var = 0;
};
const f2 = function() {
  var f2_var = 0;
};
function f3() {
  var f3_var = 0;
}
const o = {
  f4() {	
    var f4_var = 0;
  }
};
class c1 {
  method() {
    var c1_var = 0;
  }
}
const c2 = class {
  method() {
    var c2_var = 0;
  }
};

function run(){
	f1();
	f2();
	f3();
	o.f4();
	
	return testIsHoisted(c1, c2);
}

exports.run = run;
