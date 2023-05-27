import {renderLanding} from './landing.js?route=/'; // assert { route: "/" };
import {renderBlog} from './blog.js?route=/blog'; // assert { route: "/blog" };

import {renderNavbar} from './components/Navbar.js';

export function renderApp() {
  let result = renderNavbar() + `App:\n`;
  if (location.pathname.startsWith('/blog')) {
    result += renderBlog();
  } else {
    result += renderLanding();
  }
  return result;
}
