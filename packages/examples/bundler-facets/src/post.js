import {renderPostComponent} from './components/Post.js';

export function renderPost() {
  let id = location.pathname.match(/\/blog\/(\d+)/)[1];
  return renderPostComponent(id);
}
