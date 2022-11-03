import React, {useState} from 'react';
import ClassDefault from './ClassDefault';
import {ClassNamed} from './ClassNamed';
import FunctionDefault from './FunctionDefault';
import {FunctionNamed} from './FunctionNamed';

const LazyComponent = React.lazy(() => import('./LazyComponent'));

function App() {
  return (
    <div>
      <h1>App has {Math.random()}</h1>
      <ClassDefault />
      <ClassNamed />
      <FunctionDefault />
      <FunctionNamed />
      <React.Suspense fallback={<h1>Loading</h1>}>
        <LazyComponent />
      </React.Suspense>
    </div>
  );
}

export default App;
