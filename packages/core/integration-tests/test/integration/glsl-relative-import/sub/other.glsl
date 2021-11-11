#pragma glslify: b = require('./other2');

float c(float p) { return b(p)*3.0; }

#pragma glslify: export(c);
