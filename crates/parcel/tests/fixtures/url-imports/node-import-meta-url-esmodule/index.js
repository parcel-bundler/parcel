const url = new URL('./test.txt', import.meta.url);
// In Node, the URL refers to the file next to the bundle rather than a public URL.
output = {
  protocol: url.protocol,
  path: url.pathname
    .split('/')
    .slice(-2)
    .join('/')
    .replace(/-[0-9a-z]+\./, '.'),
};
