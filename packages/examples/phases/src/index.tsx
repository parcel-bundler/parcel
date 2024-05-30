import React, {FC, Suspense, lazy} from 'react';
import ReactDOM from 'react-dom';

import ModulePhase1 from './phase1';

interface DeferredImport<T> {
  onReady(resource: () => void): void;
  default: T | null;
}

function deferredLoadComponent<T>(resource: DeferredImport<T>): FC {
  let loaded = false;
  return function WrappedComponent(props) {
    if (loaded) {
      return <resource.default {...props} />;
    } else {
      throw new Promise(resolve => {
        // resource.onReady(() => {
        //   loaded = true;
        //   resolve(resource);
        // });
        loaded = true;
        resolve(resource);
      });
    }
  };
}

const ModulePhase2 = deferredLoadComponent(
  importForDisplay<typeof import('./phase2')>('./phase2'),
);
const ModuleLazy = lazy(() => import('./lazy'));

function App() {
  return (
    <>
      <div>App</div>
      <ModulePhase1 />
      <Suspense fallback={<span>Loading...</span>}>
        <ModulePhase2 />
      </Suspense>
      <Suspense fallback={<div>Loading...</div>}>
        <ModuleLazy />
      </Suspense>
    </>
  );
}

ReactDOM.render(<App />, document.getElementById('app'));
