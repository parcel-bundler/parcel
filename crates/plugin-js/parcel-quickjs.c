#include "parcel-quickjs-context.h"

/* Install an ordinary object from the same runtime during context setup, before
 * evaluating user code. The caller initializes its builtins and globalThis.
 * Borrows global; the context owns a separate, GC-traced reference. */
int parcel_set_global_object(JSContext *ctx, JSValueConst global)
{
    JSValue previous = JS_GetGlobalObject(ctx);

    /* The newly created context's global is an ordinary object. Comparing class
     * IDs rejects proxies and other exotic objects without accessing JSObject's
     * private layout or hardcoding JS_CLASS_OBJECT's numeric value. */
    if (!JS_IsObject(global) ||
        JS_GetClassID(global) != JS_GetClassID(previous)) {
        JS_FreeValue(ctx, previous);
        JS_ThrowTypeError(ctx, "vm context must be an ordinary object");
        return -1;
    }

    /* Check our generated layout against the linked engine before writing it.
     * The source header must come from the same resolved dependency and be
     * compiled for the same target as the engine. */
    if (ctx->rt != JS_GetRuntime(ctx) || !JS_IsObject(ctx->global_obj) ||
        JS_VALUE_GET_PTR(ctx->global_obj) != JS_VALUE_GET_PTR(previous)) {
        JS_FreeValue(ctx, previous);
        JS_ThrowInternalError(ctx, "QuickJS context layout mismatch");
        return -1;
    }

    JSValue owned_previous = ctx->global_obj;
    ctx->global_obj = JS_DupValue(ctx, global);
    JS_FreeValue(ctx, owned_previous);
    JS_FreeValue(ctx, previous);
    return 0;
}
