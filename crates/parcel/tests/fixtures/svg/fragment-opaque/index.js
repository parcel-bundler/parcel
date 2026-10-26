const sprite = new URL('sprite.svg', import.meta.url);
for (const name of ['badge', 'unused']) {
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${sprite}#${name}`);
  document.querySelector('svg').append(use);
}
