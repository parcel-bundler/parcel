import {renderLanding} from './landing.js?route=/'; // assert { route: "/" };
import {renderBlog} from './blog.js?route=/blog'; // assert { route: "/blog" };

export function renderApp() {
  let result = `App:\n`;
  if (location.pathname.startsWith('/blog')) {
    result += renderBlog();
  } else {
    result += renderLanding();
  }
  return result;
}
