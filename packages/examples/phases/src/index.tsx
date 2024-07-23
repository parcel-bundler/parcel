import React, {FC, Suspense, useEffect} from 'react';
import ReactDOM from 'react-dom';

import ModulePhase1 from './phase1';
import {deferredLoadComponent} from './utils';
const Phase2 = deferredLoadComponent(
  importDeferredForDisplay<typeof import('./phase2')>('./phase2'),
);
const Phase3 = deferredLoadComponent(
  importDeferred<typeof import('./phase3')>('./phase3'),
);

function App() {
  return (
    <>
      <div>App</div>
      <ModulePhase1 />
      <Suspense fallback={<div>Loading...</div>}>
        <Phase2 />
      </Suspense>
      <Suspense fallback={<div>Loading...</div>}>
        <Phase3 />
      </Suspense>
    </>
  );
}

ReactDOM.render(<App />, document.getElementById('app'));
