#pragma glslify: c = require('./sub/other');

varying float x;

void main() { gl_FragColor = vec4(c(x)); }
