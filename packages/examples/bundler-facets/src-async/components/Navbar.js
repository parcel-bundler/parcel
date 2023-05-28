function renderClientLink(to, content) {
  return `<a href="${to}" onClick="navigateClient('${to}'); return false;">${content}</a>`;
}

export default function renderNavbar() {
  return (
    [
      renderClientLink('/', 'Home'),
      renderClientLink('/blog/', '/blog/'),
      renderClientLink('/blog/1', '/blog/1'),
      renderClientLink('/blog/2', '/blog/2'),
    ].join('\n') + '<hr>\n'
  );
}
