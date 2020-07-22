export default (component, docs, attrs) => {
  if (attrs.brief)
    component.__docsBrief = docs;
  else
    component.__docs = docs;
}