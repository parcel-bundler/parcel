this.usedThis = 'used-this';

this.unusedThis = function () {
  return 'unused-this-sentinel';
};

const arrow = () => {
  this.unusedArrowThis = 'unused-arrow-this-sentinel';
};
arrow();

function Local() {
  this.localThis = 'local-this';
}
this.usedLocal = new Local().localThis;
