import renderPostComponent from './components/Post.js';

export default function renderPosts() {
  return (
    [1, 2, 3, 4]
      .map(
        id =>
          `<a href="/blog/${id}">Post ${id}</a>\n` +
          renderPostComponent(id) +
          '\n',
      )
      .join('\n') + '\n'
  );
}
