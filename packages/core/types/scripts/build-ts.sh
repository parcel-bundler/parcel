#!/bin/bash
set -x
set -e

mkdir -p lib

for file in *.js; do
  npx flow-to-ts $file > lib/$(basename $file .js).d.ts
done

node build-ts.js
