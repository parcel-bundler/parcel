import {renderPosts} from './posts.js?route=/blog/'; //  assert { route: "/blog/" };
import {renderPost} from './post.js?route=/blog/:id'; // assert { route: "/blog/:id" };

export function renderBlog() {
  let result = `Blog header\n`;
  if (location.pathname.match(/\/blog\/(\d+)/)) {
    result += renderPost();
  } /* if (location.pathname.startsWith("/blog"))*/ else {
    result += renderPosts();
  }
  return result;
}
