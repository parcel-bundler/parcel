// import bar from './test.txt';
import { testMacro, css } from './macro.mjs' with {type: 'macro'};

css('body { background-color: black; color: white }')

// const url = new URL('test.png?width=500', import.meta.url);

export function MyApp() {
  return <div className="text-white font-mono m-2">Testing: {JSON.stringify(testMacro())} {testMacro().f(7)}<br />{/*<img src={url.toString()} />*/}</div>;
}
