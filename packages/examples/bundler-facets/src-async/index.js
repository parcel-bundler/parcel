// import {renderApp} from './index2.js';
import renderApp from './app.js';

(async () => {
  document.getElementById('root').innerHTML = await renderApp();
})();
