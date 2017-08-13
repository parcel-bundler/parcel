const {Readable} = require('stream');

const prelude = `(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({`;

class JSPackager extends Readable {
  constructor(options) {
    super();
    this.options = options;
    this.first = true;
    this.dedupe = new Map;
  }

  _read() {}

  addAsset(asset) {
    if (this.dedupe.has(asset.generated.js)) {
      return;
    }

    if (this.first) {
      this.push(prelude);
    }

    this.dedupe.set(asset.generated.js, asset.id);

    let wrapped = this.first ? '' : ',';
    wrapped += asset.id + ':[function(require,module,exports) {\n' + asset.generated.js + '\n},';

    let deps = {};
    for (let [dep, mod] of asset.depAssets) {
      deps[dep] = this.dedupe.get(mod.generated.js) || mod.id;
    }

    wrapped += JSON.stringify(deps);
    wrapped += ']';

    this.first = false;
    this.push(wrapped);
  }

  end() {
    this.push('},{},' + JSON.stringify([1]) + ')');
    this.push(null);
  }
}

module.exports = JSPackager;
