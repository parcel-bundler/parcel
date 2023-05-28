// import {renderPosts} from './posts.js?route=/blog/'; //  assert { route: "/blog/" };
// import {renderPost} from './post.js?route=/blog/:id'; // assert { route: "/blog/:id" };

export default async function renderBlog() {
  let result = `Blog header\n`;
  if (location.pathname.match(/\/blog\/(\d+)/)) {
    result += await import('./post.js?route=/blog/:id').then(v => v.default());
  } /* if (location.pathname.startsWith("/blog"))*/ else {
    result += await import('./posts.js?route=/blog/').then(v => v.default());
  }
  return result;
}
