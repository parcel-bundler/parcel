/* @jsxRuntime automatic */

function CodeBlock({lang, children, render}) {
  return (
    <>
      <pre>
        <code className={lang ? `language-${lang}` : undefined}>
          {children}
        </code>
      </pre>
      {render}
    </>
  );
}

const components = {
  CodeBlock,
};

export function useMDXComponents() {
  return components;
}
