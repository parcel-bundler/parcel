export default function seo(content, {title, description}) {
  return `<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<p>Macro body content</p>`;
}
