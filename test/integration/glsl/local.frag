#version 300 es

#pragma glslify: test = require('./lib')

precision mediump float;

void main() {
  test();
}
