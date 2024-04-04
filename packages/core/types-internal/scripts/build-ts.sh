#!/bin/bash
set -x
set -e

mkdir -p lib

for file in src/*.js; do
  npx flow-to-ts $file > lib/$(basename $file .js).d.ts
done

node ./scripts/build-ts.js
