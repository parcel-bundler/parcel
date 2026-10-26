import {gain} from './gain.js';
import {name} from 'dsp';
registerProcessor(name, class extends AudioWorkletProcessor {
  process() {
    return gain > 0;
  }
});
