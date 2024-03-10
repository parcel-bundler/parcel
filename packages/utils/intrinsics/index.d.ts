/** Requires an already loaded module by public id. */
export declare function requireModuleById(id: string): any;
/** Loads an ESM bundle from a URL relative to the target dist dir. */
export declare function loadESMBundle(url: string): Promise<any>;
