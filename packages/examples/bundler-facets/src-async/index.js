// import {renderApp} from './index2.js';
import renderApp from './app.js';

window.navigateClient = url => {
  window.history.pushState({}, undefined, url);
  render();
};

async function render() {
  document.getElementById('root').innerHTML = await renderApp();
}

render();
window.addEventListener('popstate', () => {
  render();
});
