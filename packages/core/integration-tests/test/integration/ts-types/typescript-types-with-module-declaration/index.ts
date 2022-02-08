import type { hoge } from 'hoge';

declare module 'hoge' {
  export interface Bar {}
}

const h: hoge = 'hoge';
