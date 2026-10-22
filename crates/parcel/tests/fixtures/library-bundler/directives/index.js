"use client";
import {css} from './macro.mjs' with {type: 'macro'};
import {foo} from './foo';
import path from 'path';
export const name = css('.a { color: red }');
export const value = foo + path.sep;
