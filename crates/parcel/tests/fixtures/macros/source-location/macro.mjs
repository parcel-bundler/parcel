export function hash() {
  const loc = this.loc;
  return {line: loc.line, col: loc.col};
}
