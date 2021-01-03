import * as React from 'react';
import ReactDOM from 'react-dom';

console.log({hmrOptions: module.hmrOptions});

if (module.hmrOptions) {
  module.hmrOptions.dispose(function() {
    console.log('HOT DISPOSE');
  });

  module.hmrOptions.accept(function() {
    console.log('HOT ACCEPT');
  });
}

ReactDOM.render(<div>Hello world!</div>, document.getElementById('app'));
