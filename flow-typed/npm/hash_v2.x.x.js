// @flow

declare module '@parcel/hash' {
  declare export function hashString(s: string): string;
  declare export function hashBuffer(b: Buffer): string;
  declare export class Hash {
    writeString(s: string): void;
    writeBuffer(b: Buffer): void;
    finish(): string;
  }
}
