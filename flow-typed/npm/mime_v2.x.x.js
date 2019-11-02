// flow-typed signature: 31e500511ae049defd391e018e0d8fa9
// flow-typed version: c6154227d1/mime_v2.x.x/flow_>=v0.104.x

declare type $npm$mime$TypeMap = { [mime: string]: Array<string>, ... };

declare class $npm$mime$Mime {
  constructor(...typeMap: Array<$npm$mime$TypeMap>): void;

  define(typeMap: $npm$mime$TypeMap, force?: boolean): void;
  getExtension(mime: string): ?string;
  getType(path: string): ?string;
}

declare module 'mime' {
  declare type TypeMap = $npm$mime$TypeMap;
  declare module.exports: $npm$mime$Mime;
}

declare module 'mime/lite' {
  declare type TypeMap = $npm$mime$TypeMap;
  declare module.exports: $npm$mime$Mime;
}

declare module 'mime/Mime' {
  declare type TypeMap = $npm$mime$TypeMap;
  declare module.exports: typeof $npm$mime$Mime;
}
