#!/bin/bash

set -e

if grep -q "DEV BIN - DO NOT PUBLISH" lib/bin.js
then
  echo "found dev files in lib"
  exit 1
else
  echo "no dev files in lib"
  exit 0
fi
