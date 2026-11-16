export function box(content, { kind }) {
  return `<section class="box ${kind}">${content}</section>`;
}

export function item(content, { name }) {
  return `<div class="item"><em>${name}</em>${content}</div>`;
}
