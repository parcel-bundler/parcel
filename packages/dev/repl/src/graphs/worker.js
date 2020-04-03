import {expose, proxy} from 'comlink';
import dot from '@mischnic/dot-svg';
import WASM_URL from "url:@mischnic/dot-svg/dist/index-browser.wasm";

const render = dot(() => WASM_URL);

expose({
  render: proxy((...a) => render.then(f => f(...a))),
});
