import * as React from 'react';
import ReactDOM from 'react-dom';

console.log({hmrOptions: module.hot});

if (module.hot) {
  module.hot.dispose(function() {
    console.log('HOT DISPOSE');
  });

  module.hot.accept(function() {
    console.log('HOT ACCEPT');
  });
}

ReactDOM.render(<div>Hello world!</div>, document.getElementById('app'));
