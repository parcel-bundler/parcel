import bar from './test.txt';
import { testMacro } from './macro.mjs' with {type: 'macro'};

// const url = new URL('test.png?width=500', import.meta.url);

export function MyApp() {
  return <div className="text-white font-mono m-2">Testing: {JSON.stringify(testMacro())} {testMacro().f(7)} {bar}<br />{/*<img src={url.toString()} />*/}</div>;
}
