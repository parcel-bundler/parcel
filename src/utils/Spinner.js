const {EventEmitter} = require('events');
const emoji = require('./emoji');

class Spinner extends EventEmitter {
  constructor(spinnerSymbols = emoji.progressSpinner, interval = 50) {
    super();
    this.spinnerSymbols = spinnerSymbols;
    this.interval = interval;
    this.currentSymbol = {
      id: 0,
      symbol: this.spinnerSymbols[0]
    };
    this.start();
  }

  start() {
    if (!this.intervalTimer) {
      this.intervalTimer = setInterval(
        this.updateSpinner.bind(this),
        this.interval
      );
    }
  }

  stop() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
  }

  updateSpinner() {
    const nextId =
      this.currentSymbol.id < this.spinnerSymbols.length - 1
        ? this.currentSymbol.id + 1
        : 0;
    this.currentSymbol = {
      id: nextId,
      symbol: this.spinnerSymbols[nextId]
    };
    this.emit('spinnerUpdate', this.currentSymbol.symbol);
  }
}

module.exports = Spinner;
