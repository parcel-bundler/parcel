type ModuleRef<_> = string;
type ErrorMessage = 'You must annotate type with "<typeof import(\'xyz\')>"';

interface DeferredImport<T> {
  onReady(resource: () => void): void;
  default: T | null;
}

declare function importForDisplay<T extends any | void = void>(
  id: T extends void ? ErrorMessage : ModuleRef<T>,
): DeferredImport<T>;

declare function importAfterDisplay<T extends any | void = void>(
  id: T extends void ? ErrorMessage : ModuleRef<T>,
): DeferredImport<T>;
