import {renderPostComponent} from './components/Post.js';
import {renderPostComments} from './components/PostComments.js';

export function renderPost() {
  let id = location.pathname.match(/\/blog\/(\d+)/)[1];
  return renderPostComponent(id) + renderPostComments(id);
}
