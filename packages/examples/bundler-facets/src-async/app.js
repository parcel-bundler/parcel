// import {renderLanding} from './landing.js?route=/'; // assert { route: "/" };
// import {renderBlog} from './blog.js?route=/blog'; // assert { route: "/blog" };

import renderNavbar from './components/Navbar.js';

export default async function renderApp() {
  let result = (await renderNavbar()) + `App:\n`;
  if (location.pathname.startsWith('/blog')) {
    result += await import('./blog.js?route=/blog').then(v => v.default());
  } else {
    result += await import('./landing.js?route=/').then(v => v.default());
  }
  return result;
}
