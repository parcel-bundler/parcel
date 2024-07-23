type ModuleRef<_> = string;
type ErrorMessage = 'You must annotate type with "<typeof import(\'xyz\')>"';

interface DeferredImport<T> {
  onReady(resource: () => void): () => void;
  mod: T | null;
}

declare function importDeferredForDisplay<T extends any | void = void>(
  source: T extends void ? ErrorMessage : ModuleRef<T>,
): DeferredImport<T>;

declare function importDeferred<T extends any | void = void>(
  source: T extends void ? ErrorMessage : ModuleRef<T>,
): DeferredImport<T>;
