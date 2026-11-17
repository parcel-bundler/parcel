const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function entries(content, { count }) {
  let result = '';
  for (let i = 1; i <= Number(count); i++) {
    result += `<entry>
    <title>Post ${i}</title>
    <link href="post.html"/>
    <content type="html">${escape(`<p>Post ${i}</p><img src="100x100.png"><parcel:include src="fragment.html"></parcel:include>`)}</content>
  </entry>`;
  }
  return result;
}
