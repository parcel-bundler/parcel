/* @jsxRuntime automatic */

const CLIENT_REFERENCE = Symbol.for('react.client.reference');

// `render` is the rendered code block's default export: a component, or a value to render as is.
function CodeBlock({lang, children, render: Render}) {
  let isComponent = typeof Render === 'function' || Render?.$$typeof === CLIENT_REFERENCE;
  return (
    <>
      <pre>
        <code className={lang ? `language-${lang}` : undefined}>
          {children}
        </code>
      </pre>
      {isComponent ? <Render /> : Render}
    </>
  );
}

const components = {
  CodeBlock,
};

export function useMDXComponents() {
  return components;
}
