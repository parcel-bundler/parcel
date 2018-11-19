// @flow

export interface PostHTMLAST {
  walk(fn: (node: PostHTMLNode) => PostHTMLNode): void;
}

export type PostHTMLNode = {
  tag: string,
  attrs?: {[string]: string},
  content?: Array<string>
};
