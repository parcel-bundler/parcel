#!/usr/bin/env node

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || 16;

// Node 8 supports native async functions - no need to use compiled code!
module.exports =
  parseInt(process.versions.node, 10) < 8
    ? require('../lib/cli')
    : require('../src/cli');
