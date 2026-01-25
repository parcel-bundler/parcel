#!/usr/bin/env node

// import {foo, MyApp} from './re-export';
// import {test} from './a.module.css';
// import './test.less';
// import bar from './test.txt';
// import baz from './test2.txt'
import './index.css';

import {MyApp} from "./bar";
import {createRoot} from 'react-dom/client';

// console.log(test);
// console.log(MyApp);
createRoot(root).render(<MyApp />);

// import('./async').then((res) => console.log('hi', res));
