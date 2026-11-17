export default function (content, props) {
  return `<div data-prop="${props.prop}">${content.toUpperCase()}</div>`;
}

export function other(content) {
  return `<strong>${content}</strong>`
}

export function code(content, props) {
  return `<pre data-lang="${props.lang}"><code>${content}</code></pre>`
}

export function nav() {
  return `<a href="other.html">Other</a> <parcel:macro src="macro.mjs#other">nested</parcel:macro>`;
}
