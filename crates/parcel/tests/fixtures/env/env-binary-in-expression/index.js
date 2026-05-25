const existVar = 'ABC' in process.env ? 'correct' : 'incorrect';
const notExistVar = 'DEF' in process.env ? 'incorrect' : 'correct';

module.exports = {
  existVar,
  notExistVar,
};
