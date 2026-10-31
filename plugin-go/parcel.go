// Package parcel provides an idiomatic Go API for building Parcel transformer,
// resolver, namer, optimizer, and reporter plugins. Plugins import this package, register
// a plugin with [RegisterPlugin], and export the compiled shared library:
//
//	go build -buildmode=c-shared -o plugin.dylib .
//
// The library exports C entry points which Parcel calls for the plugin type
// selected in its configuration.
//
// plugin.h is auto-copied here from crates/parcel-plugin-abi/plugin.h by that
// crate's build.rs whenever the Rust crate is rebuilt.  To sync it manually
// without a full Cargo build, run from the repo root:
//
//	cp crates/parcel-plugin-abi/plugin.h plugin-go/
package parcel

/*
#include <stdlib.h>
// cgo declares the //export entry points below itself, without plugin.h's
// const qualifiers, so plugin.h must not declare them too.
#define PARCEL_NO_ENTRY_POINT_PROTOTYPES
#include "plugin.h"

// parcel_api is defined in api.c and assigned by parcel_plugin_init below.
// Plugins link against no Parcel symbols, so no linker flags are needed on any
// platform. This preamble must stay free of definitions: the file has //export
// directives, so cgo copies it into more than one translation unit.
*/
import "C"
import (
	"errors"
	"fmt"
	"io/fs"
	"runtime"
	"runtime/cgo"
	"sync"
	"time"
	"unicode/utf8"
	"unsafe"
)

// A plugin is any value implementing one or more of [Transformer], [Resolver],
// [Namer], [Optimizer] and [Reporter], returned by the factory passed to
// [RegisterPlugin]. Parcel calls the method for the role its .parcelrc entry
// gives it, and a plugin used in a role it does not implement fails with a
// diagnostic saying so. A kind of plugin Parcel adds later is a new interface,
// so existing plugins keep compiling.
//
// Parcel calls one plugin from many goroutines at once: transforms and resolves
// run in parallel, as do optimizers, and log events reach Report from whichever
// thread logged them. Guard any state that changes with a mutex or atomics.
//
// The values a method receives, such as *Asset, *Options, *BundleGraph and
// everything obtained from them, are valid only until the method returns. Never
// keep one, in the plugin or in custom content, or use it from a goroutine that
// outlives the call. Inputs Parcel adds later arrive through *Options, which is
// the context of the current call.

// Transformer transforms assets, in place.
type Transformer interface {
	Transform(asset *Asset, options *Options) error
}

// Resolver resolves dependency specifiers. pipeline is the named pipeline in
// the specifier, or "" when it has none. Return the zero ResolveResult to let
// the next resolver try.
type Resolver interface {
	Resolve(dependency *Dependency, specifier, pipeline string, options *Options) (ResolveResult, error)
}

// Namer names bundles. Return a path relative to the bundle target's dist
// directory, or "" to let the next namer try.
type Namer interface {
	Name(bundleGraph *BundleGraph, bundle *Bundle, options *Options) (string, error)
}

// Optimizer optimizes packaged bundles. sourceMap is the bundle's JSON (v3)
// source map, or "" when it has none.
type Optimizer interface {
	Optimize(bundleGraph *BundleGraph, bundle *Bundle, contents []byte, sourceMap string, options *Options) (OptimizeResult, error)
}

// Reporter handles build events. A returned error is printed rather than
// failing the build: a reporter cannot fail a build that produced its output.
type Reporter interface {
	Report(event ReportEvent, options *Options) error
}

// OptimizeResult is the content and optional source map returned by an optimizer.
type OptimizeResult struct {
	Contents Content
	// SourceMap is a JSON (v3) source map for Contents. "" removes the bundle's
	// source map.
	SourceMap string
}

// pluginFactory is the registered plugin factory function.
var pluginFactory func(config []byte) (any, error)

// RegisterPlugin sets the factory Parcel calls for each .parcelrc entry naming
// the plugin, with that entry's config as JSON (nil when it has none). The
// factory returns the plugin: a value implementing at least one of
// [Transformer], [Resolver], [Namer], [Optimizer] and [Reporter].
//
// Call RegisterPlugin once, from an init() function in the plugin's main package.
func RegisterPlugin(factory func(config []byte) (any, error)) {
	pluginFactory = factory
}

var errNotRegistered = errors.New("plugin not registered: call parcel.RegisterPlugin in init()")

// pluginAs returns the plugin behind state as a T, the interface for the role
// Parcel is calling it in, or an error naming that role's method when the
// plugin does not implement it.
func pluginAs[T any](state unsafe.Pointer, method string) (T, error) {
	var role T
	if state == nil {
		return role, errNotRegistered
	}
	role, ok := cgo.Handle(*(*C.uintptr_t)(state)).Value().(T)
	if !ok {
		return role, fmt.Errorf("plugin does not implement %s, so it cannot be used in that role", method)
	}
	return role, nil
}

// hasRole reports whether plugin implements any role Parcel can call it in.
func hasRole(plugin any) bool {
	switch plugin.(type) {
	case Transformer, Resolver, Namer, Optimizer, Reporter:
		return true
	}
	return false
}

// installAPI guards installing the host table: Parcel may initialize several
// .parcelrc entries naming this library at once.
var installAPI sync.Mutex

//export parcel_plugin_init
func parcel_plugin_init(api *C.struct_ParcelApi, config *C.uint8_t, configLen C.uintptr_t, outState *unsafe.Pointer, diag *C.DiagnosticOptions) (status C.InitStatus) {
	defer func() {
		if value := recover(); value != nil {
			status = C.InitStatus(C.PARCEL_INIT_ERROR)
			writeDiagnostic(diag, panicError("init", value))
		}
	}()

	// A different table means two Parcel instances share this library, which
	// cannot work: whichever lost would be calling the other's functions.
	installAPI.Lock()
	compatible := api != nil && bool(C.parcel_api_compatible(&api.header)) && (C.parcel_api == nil || C.parcel_api == api)
	if compatible {
		C.parcel_api = api
	}
	installAPI.Unlock()
	if !compatible {
		return C.InitStatus(C.PARCEL_INIT_INCOMPATIBLE)
	}

	if pluginFactory == nil {
		writeDiagnostic(diag, errNotRegistered)
		return C.InitStatus(C.PARCEL_INIT_ERROR)
	}
	var data []byte
	if configLen > 0 && config != nil {
		data = goBytes(unsafe.Pointer(config), uintptr(configLen))
	}
	plugin, err := pluginFactory(data)
	if err == nil && !hasRole(plugin) {
		err = fmt.Errorf("the plugin factory returned %T, which implements none of Transformer, Resolver, Namer, Optimizer and Reporter", plugin)
	}
	if err != nil {
		writeDiagnostic(diag, err)
		return C.InitStatus(C.PARCEL_INIT_ERROR)
	}
	// Store the plugin in a cgo.Handle so it can safely
	// round-trip through C memory. The handle ID lives in a C-allocated block
	// to avoid go vet's uintptr→unsafe.Pointer warning (cgo.Handle is an
	// integer, not a GC pointer, but the tool cannot distinguish the two).
	handle := cgo.NewHandle(plugin)
	p := (*C.uintptr_t)(C.malloc(C.size_t(unsafe.Sizeof(C.uintptr_t(0)))))
	*p = C.uintptr_t(handle)
	if outState != nil {
		*outState = unsafe.Pointer(p)
	}
	return C.InitStatus(C.PARCEL_INIT_OK)
}

//export parcel_plugin_deinit
func parcel_plugin_deinit(state unsafe.Pointer) {
	defer recoverCleanupPanic()
	if state == nil {
		return
	}
	p := (*C.uintptr_t)(state)
	handle := cgo.Handle(*p)
	C.free(state)
	handle.Delete()
}

//export parcel_plugin_transform
func parcel_plugin_transform(asset C.Asset, rawOptions C.Options, state unsafe.Pointer, diag *C.DiagnosticOptions) {
	defer recoverDiagnostic("transform", diag)
	plugin, err := pluginAs[Transformer](state, "Transform")
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	a := &Asset{ptr: asset, options: rawOptions}
	opts := &Options{ptr: rawOptions}
	if err := plugin.Transform(a, opts); err != nil {
		writeDiagnostic(diag, err)
	}
}

//export parcel_plugin_resolve
func parcel_plugin_resolve(dep C.Dependency, specifier *C.uint8_t, specifierLen C.uintptr_t, pipeline *C.uint8_t, pipelineLen C.uintptr_t, rawOptions C.Options, result *C.ResolveResult, state unsafe.Pointer, diag *C.DiagnosticOptions) {
	defer recoverDiagnostic("resolve", diag)
	plugin, err := pluginAs[Resolver](state, "Resolve")
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	d := &Dependency{ptr: C.Dependency(dep), options: rawOptions}
	spec := goString(unsafe.Pointer(specifier), uintptr(specifierLen))
	pipe := goString(unsafe.Pointer(pipeline), uintptr(pipelineLen))
	opts := &Options{ptr: rawOptions}
	resolution, err := plugin.Resolve(d, spec, pipe, opts)
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	writeResolveResult(result, resolution)
}

//export parcel_plugin_name
func parcel_plugin_name(rawGraph C.BundleGraph, rawBundle C.Bundle, rawOptions C.Options, result *C.Buffer, state unsafe.Pointer, diag *C.DiagnosticOptions) {
	defer recoverDiagnostic("name", diag)
	plugin, err := pluginAs[Namer](state, "Name")
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	name, err := plugin.Name(
		&BundleGraph{ptr: rawGraph, options: rawOptions},
		&Bundle{ptr: rawBundle, options: rawOptions},
		&Options{ptr: rawOptions},
	)
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	if len(name) > 0 && result != nil {
		ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(name)))
		// Only valid UTF-8 may be marked as such; Parcel checks anything else
		// itself and reports a name it cannot use.
		if utf8.ValidString(name) {
			C.parcel_buffer_write_utf8(result, ptr, C.uintptr_t(len(name)))
		} else {
			C.parcel_buffer_write(result, ptr, C.uintptr_t(len(name)))
		}
	}
}

//export parcel_plugin_optimize
func parcel_plugin_optimize(rawGraph C.BundleGraph, rawBundle C.Bundle, contents *C.uint8_t, contentsLen C.uintptr_t, sourceMap *C.uint8_t, sourceMapLen C.uintptr_t, rawOptions C.Options, rawResult *C.OptimizeResult, state unsafe.Pointer, diag *C.DiagnosticOptions) {
	defer recoverDiagnostic("optimize", diag)
	plugin, err := pluginAs[Optimizer](state, "Optimize")
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}

	var contentBytes []byte
	if contents != nil && contentsLen > 0 {
		contentBytes = goBytes(unsafe.Pointer(contents), uintptr(contentsLen))
	}
	result, err := plugin.Optimize(
		&BundleGraph{ptr: rawGraph, options: rawOptions},
		&Bundle{ptr: rawBundle, options: rawOptions},
		contentBytes,
		goString(unsafe.Pointer(sourceMap), uintptr(sourceMapLen)),
		&Options{ptr: rawOptions},
	)
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	if rawResult == nil {
		return
	}
	// Parcel allocated rawResult and set its size, so write it field by field.
	// Both fields are in the first layout; a field added later must check
	// rawResult.size.
	if err := writeContentBuffer(&rawResult.contents, result.Contents); err != nil {
		writeDiagnostic(diag, err)
		return
	}
	if result.SourceMap != "" {
		if err := writeContentBuffer(&rawResult.source_map, BytesContent(result.SourceMap)); err != nil {
			writeDiagnostic(diag, err)
		}
	}
}

//export parcel_plugin_report
func parcel_plugin_report(rawEvent *C.ReportEvent, rawOptions C.Options, state unsafe.Pointer, diag *C.DiagnosticOptions) {
	defer recoverDiagnostic("report", diag)
	plugin, err := pluginAs[Reporter](state, "Report")
	if err != nil {
		writeDiagnostic(diag, err)
		return
	}
	// Parcel may be older or newer than this SDK, so the event is only as large
	// as its size says. Every field read below is in the first layout, which ends at
	// changed_asset_count; a smaller event is not one this SDK can make sense of.
	// A field added later needs its own size check before it is read.
	if rawEvent == nil || uintptr(rawEvent.size) < unsafe.Offsetof(rawEvent.changed_asset_count)+unsafe.Sizeof(rawEvent.changed_asset_count) {
		return
	}

	// Only set for the events that carry them, so reading the field on any
	// other event is a nil the plugin cannot reach in the first place.
	var diagnostics *Diagnostics
	if rawEvent.diagnostics != 0 {
		diagnostics = &Diagnostics{ptr: rawEvent.diagnostics}
	}

	var event ReportEvent
	switch rawEvent.event_type {
	case C.ReportEventType(C.PARCEL_EVENT_BUILD_START):
		event = &BuildStart{}

	case C.ReportEventType(C.PARCEL_EVENT_BUILD_SUCCESS):
		success := &BuildSuccess{
			BundleGraph: &BundleGraph{ptr: rawEvent.bundle_graph, options: rawOptions},
			BuildTime:   time.Duration(rawEvent.build_time_ms) * time.Millisecond,
		}
		if rawEvent.changed_assets != nil && rawEvent.changed_asset_count > 0 {
			raw := unsafe.Slice(rawEvent.changed_assets, int(rawEvent.changed_asset_count))
			success.ChangedAssets = make([]AssetIndex, len(raw))
			for i, index := range raw {
				success.ChangedAssets[i] = AssetIndex(index)
			}
		}
		event = success

	case C.ReportEventType(C.PARCEL_EVENT_BUILD_FAILURE):
		event = &BuildFailure{Diagnostics: diagnostics}

	case C.ReportEventType(C.PARCEL_EVENT_LOG):
		log := &Log{Level: LogLevel(rawEvent.level), Diagnostics: diagnostics}
		if rawEvent.message != nil {
			log.Message = goString(unsafe.Pointer(rawEvent.message), uintptr(rawEvent.message_len))
		}
		event = log

	default:
		// An event added to Parcel after this SDK was built. Reporting nothing
		// beats reporting it as the wrong kind of event.
		return
	}

	if err := plugin.Report(event, &Options{ptr: rawOptions}); err != nil {
		writeDiagnostic(diag, err)
	}
}

func panicError(scope string, value any) error {
	var message string
	switch value := value.(type) {
	case error:
		message = value.Error()
	case string:
		message = value
	default:
		message = fmt.Sprint(value)
	}
	return fmt.Errorf("plugin panicked in %s: %s", scope, message)
}

func recoverDiagnostic(scope string, diagnostic *C.DiagnosticOptions) {
	if value := recover(); value != nil {
		writeDiagnostic(diagnostic, panicError(scope, value))
	}
}

func recoverCleanupPanic() {
	_ = recover()
}

// writeDiagnostic fills a Diagnostic from an error. If err is a *Diagnostic,
// all fields are copied; otherwise only the message is set.
//
// raw is usually one Parcel allocated, whose size Parcel set to the struct it
// was built with, so it is written field by field and its size left alone:
// assigning the whole struct would overwrite size, and run past the end of an
// older Parcel's smaller struct. Every field written here is in the first layout; a field
// added later must check raw.size before writing it.
func writeDiagnostic(raw *C.DiagnosticOptions, err error) {
	if raw == nil || err == nil {
		return
	}
	var d *Diagnostic
	if !errors.As(err, &d) {
		d = &Diagnostic{Message: err.Error()}
	}
	if d.parcelDiagnostics != 0 {
		raw.diagnostics = d.parcelDiagnostics
		return
	}
	message := d.Message
	if message == "" {
		// Parcel reads a missing message as no diagnostic at all, which would
		// turn this failure into a success.
		message = "unknown error"
	}
	writeBuffer := func(buf *C.Buffer, s string) {
		if len(s) == 0 {
			return
		}
		data := []byte(s)
		*buf = C.parcel_buffer_alloc((*C.uint8_t)(unsafe.Pointer(&data[0])), C.uintptr_t(len(data)))
	}
	writeBuffer(&raw.message, message)
	raw.severity = C.uint8_t(d.Severity)
	writeBuffer(&raw.file_path, d.FilePath)
	raw.line = C.uint32_t(d.Line)
	raw.column = C.uint32_t(d.Column)
	writeBuffer(&raw.hint, d.Hint)
	raw.end_line = C.uint32_t(d.EndLine)
	raw.end_column = C.uint32_t(d.EndColumn)
	writeBuffer(&raw.highlight_message, d.HighlightMessage)
	writeBuffer(&raw.documentation_url, d.DocumentationURL)
}

// Asset represents the asset being transformed. All methods translate directly
// to the corresponding Parcel C ABI calls.
type Asset struct {
	ptr     C.Asset
	options C.Options
}

// Content reads the asset's content as text. It fails when the content cannot
// be read, or is not valid UTF-8, with an error to return as is: Parcel then
// reports why exactly as it determined it.
func (a *Asset) Content() (string, error) {
	return readContentString(a.ptr, a.options)
}

// ContentBytes reads the asset's content as bytes. It fails when the content
// cannot be read, with an error to return as is.
func (a *Asset) ContentBytes() ([]byte, error) {
	return readContentBytes(a.ptr, a.options)
}

// readContentString reads an asset's content as UTF-8 text.
func readContentString(asset C.Asset, options C.Options) (string, error) {
	var buf C.Buffer
	var diagnostics C.Diagnostics
	if !C.parcel_asset_get_content_utf8(&buf, asset, options, &diagnostics) {
		return "", parcelDiagnosticsError(diagnostics, "Parcel could not read the asset's content")
	}
	return takeBufferString(&buf), nil
}

// readContentBytes reads an asset's content as bytes.
func readContentBytes(asset C.Asset, options C.Options) ([]byte, error) {
	var buf C.Buffer
	var diagnostics C.Diagnostics
	if !C.parcel_asset_get_content(&buf, asset, options, &diagnostics) {
		return nil, parcelDiagnosticsError(diagnostics, "Parcel could not read the asset's content")
	}
	defer C.parcel_free_buffer(&buf)
	return goBytes(unsafe.Pointer(buf.data), uintptr(buf.len)), nil
}

// SetContent replaces the asset content with the given string.
//
// A Go string can hold any bytes. Content that is not valid UTF-8 is stored
// as bytes, as SetContentBytes would, rather than as text.
func (a *Asset) SetContent(content string) {
	// Parcel trusts content passed as UTF-8 without checking it, so only
	// validated content may be.
	if !utf8.ValidString(content) {
		C.parcel_asset_set_content(a.ptr, nonNullPtr(content), C.uintptr_t(len(content)), nil, 0)
		return
	}
	C.parcel_asset_set_content_utf8(a.ptr, nonNullPtr(content), C.uintptr_t(len(content)), nil, 0)
}

// SetContentBytes replaces the asset content with the given byte slice.
func (a *Asset) SetContentBytes(content []byte) {
	ptr := nonNullPtr(unsafe.String(unsafe.SliceData(content), len(content)))
	C.parcel_asset_set_content(a.ptr, ptr, C.uintptr_t(len(content)), nil, 0)
}

// SetContentWithMap replaces the asset content, along with a JSON (v3) source
// map describing it.
//
// The map's sources may be absolute paths, file:// URLs, or paths relative to
// the asset's directory. Parcel composes it with the maps of later transformers,
// so the final bundle maps back to the files this transformer read.
//
// Content that is not valid UTF-8 is stored as bytes, as with SetContent.
func (a *Asset) SetContentWithMap(content string, sourceMap string) {
	// Parcel trusts content passed as UTF-8 without checking it, so only
	// validated content may be.
	if !utf8.ValidString(content) {
		C.parcel_asset_set_content(a.ptr, nonNullPtr(content), C.uintptr_t(len(content)), stringPtr(sourceMap), C.uintptr_t(len(sourceMap)))
		return
	}
	C.parcel_asset_set_content_utf8(a.ptr, nonNullPtr(content), C.uintptr_t(len(content)), stringPtr(sourceMap), C.uintptr_t(len(sourceMap)))
}

// SetContentBytesWithMap replaces the asset content with the given bytes, along
// with a JSON (v3) source map describing them. See [Asset.SetContentWithMap].
func (a *Asset) SetContentBytesWithMap(content []byte, sourceMap string) {
	C.parcel_asset_set_content(a.ptr, nonNullPtr(unsafe.String(unsafe.SliceData(content), len(content))), C.uintptr_t(len(content)), stringPtr(sourceMap), C.uintptr_t(len(sourceMap)))
}

// SourceMap returns the JSON (v3) source map describing the current content, or
// "" if it has none.
//
// This is the map an earlier transformer attached (with [Asset.SetContentWithMap]
// in a native plugin, or setCode(code, map) in a JS one), exactly as it was set:
// its sources may be absolute paths, file:// URLs, or paths relative to the
// asset's directory. Replacing the content without a map drops it, so a
// transformer that edits the content should update this map and pass it back
// with [Asset.SetContentWithMap] to keep the bundle mapping to the original files.
func (a *Asset) SourceMap() string {
	var buf C.Buffer
	C.parcel_asset_get_map(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// nonNullPtr is like stringPtr, but never nil: the content setters ignore a null
// pointer, and must still be able to empty an asset.
func nonNullPtr(s string) *C.uint8_t {
	if len(s) == 0 {
		empty := byte(0)
		return (*C.uint8_t)(unsafe.Pointer(&empty))
	}
	return stringPtr(s)
}

// Type returns the asset's type extension (e.g. "js", "css", "txt").
func (a *Asset) Type() string {
	var buf C.Buffer
	C.parcel_asset_get_type(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// SetType changes the asset type to the given file extension.
func (a *Asset) SetType(ty string) {
	if len(ty) == 0 {
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(ty)))
	C.parcel_asset_set_type(a.ptr, ptr, C.uintptr_t(len(ty)))
}

// FilePath returns the absolute filesystem path of the source asset.
func (a *Asset) FilePath() string {
	var buf C.Buffer
	C.parcel_asset_get_file_path(&buf, a.ptr, a.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// Query returns the query string from the asset's source URL.
func (a *Asset) Query() string {
	var buf C.Buffer
	C.parcel_asset_get_query(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// Pipeline returns the named pipeline (empty string if not set).
func (a *Asset) Pipeline() string {
	var buf C.Buffer
	C.parcel_asset_get_pipeline(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// SetPipeline sets the named pipeline. Pass an empty string to clear.
func (a *Asset) SetPipeline(pipeline string) {
	if pipeline == "" {
		C.parcel_asset_set_pipeline(a.ptr, nil, 0)
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(pipeline)))
	C.parcel_asset_set_pipeline(a.ptr, ptr, C.uintptr_t(len(pipeline)))
}

// BundleBehavior returns the asset's bundle behavior.
func (a *Asset) BundleBehavior() BundleBehavior {
	return BundleBehavior(C.parcel_asset_get_bundle_behavior(a.ptr))
}

// SetBundleBehavior sets the asset's bundle behavior.
func (a *Asset) SetBundleBehavior(b BundleBehavior) {
	C.parcel_asset_set_bundle_behavior(a.ptr, C.uint8_t(b))
}

// Flags returns the raw AssetFlags bitfield.
func (a *Asset) Flags() AssetFlags {
	return AssetFlags(C.parcel_asset_get_flags(a.ptr))
}

// SetFlags replaces the AssetFlags bitfield.
func (a *Asset) SetFlags(flags AssetFlags) {
	C.parcel_asset_set_flags(a.ptr, C.uint32_t(flags))
}

// HasFlag reports whether all bits in mask are set in the asset flags.
func (a *Asset) HasFlag(mask AssetFlags) bool {
	return a.Flags()&mask == mask
}

// UniqueKey returns the asset's unique key (empty string if not set).
func (a *Asset) UniqueKey() string {
	var buf C.Buffer
	C.parcel_asset_get_unique_key(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// SetUniqueKey sets the asset's unique key. Pass an empty string to clear.
func (a *Asset) SetUniqueKey(key string) {
	if key == "" {
		C.parcel_asset_set_unique_key(a.ptr, nil, 0)
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(key)))
	C.parcel_asset_set_unique_key(a.ptr, ptr, C.uintptr_t(len(key)))
}

// Target returns the target configuration for this asset (read-only).
func (a *Asset) Target() *Target {
	return &Target{ptr: C.parcel_asset_get_target(a.ptr), options: a.options}
}

// DependencyCount returns the number of dependencies the asset has so far.
func (a *Asset) DependencyCount() int {
	return int(C.parcel_asset_get_dependency_count(a.ptr))
}

// Dependency returns the dependency at index. It is invalid after the next
// [Asset.AddDependency].
func (a *Asset) Dependency(index int) (*Dependency, bool) {
	raw := C.parcel_asset_get_dependency(a.ptr, C.uintptr_t(index))
	if raw == 0 {
		return nil, false
	}
	return &Dependency{ptr: raw, options: a.options}, true
}

// Dependencies returns the asset's dependencies so far: those earlier
// transformers added, and this one. They are invalid after the next
// [Asset.AddDependency].
func (a *Asset) Dependencies() []*Dependency {
	count := a.DependencyCount()
	dependencies := make([]*Dependency, 0, count)
	for index := 0; index < count; index++ {
		if dependency, ok := a.Dependency(index); ok {
			dependencies = append(dependencies, dependency)
		}
	}
	return dependencies
}

// AddDependency appends a dependency to the asset. The dependency inherits the
// asset's target.
//
// It fails when Parcel cannot honor dep, e.g. because it uses a [SpecifierType],
// [Priority], [BundleBehavior], or [ImportType] value this version of Parcel does
// not support.
func (a *Asset) AddDependency(dep DependencyOptions) error {
	var cDep C.DependencyOptions
	var pinner runtime.Pinner
	defer pinner.Unpin()
	dep.writeRaw(&cDep, &pinner)
	if !C.parcel_asset_add_dependency(a.ptr, &cDep) {
		return fmt.Errorf("Parcel could not add the dependency %q: it uses an option this version of Parcel does not support.", dep.Specifier)
	}
	return nil
}

// Resolve resolves dep with the configured resolver plugins, exactly as if it
// had been added with [Asset.AddDependency], without adding it.
//
// from is the absolute path of the file containing the import, when that is not
// the asset itself, e.g. a Sass partial the asset pulled in. Pass "" to resolve
// from the asset. Every file the resolvers read or probe invalidates the asset,
// so the transform re-runs when the result would change.
//
// It returns the zero ResolveResult when no resolver claimed the dependency. It
// returns an error when one failed, which carries the diagnostics the resolver
// reported, so returning it reports them unchanged, or when Parcel cannot honor
// dep. Only available while transforming.
func (a *Asset) Resolve(dep DependencyOptions, from string) (ResolveResult, error) {
	failed := fmt.Errorf("could not resolve %q", dep.Specifier)
	var cDep C.DependencyOptions
	var pinner runtime.Pinner
	defer pinner.Unpin()
	dep.writeRaw(&cDep, &pinner)
	// The result is ours to allocate: zeroed, with the size this SDK was built
	// with, so Parcel writes only the fields both sides know.
	var raw C.ResolveResult
	raw.size = C.sizeof_ResolveResult
	var diagnostics C.Diagnostics
	resolved := C.parcel_asset_resolve(a.ptr, a.options, &cDep, stringPtr(from), C.uintptr_t(len(from)), &raw, &diagnostics)
	// Taken whatever the outcome, so the buffers are always freed.
	filePath := string(bufferBytes(&raw.file_path))
	pipeline := string(bufferBytes(&raw.pipeline))
	if !resolved {
		return ResolveResult{}, parcelDiagnosticsError(diagnostics, failed.Error())
	}

	switch raw.resolution_type {
	case C.PARCEL_RESOLUTION_FILE_PATH:
		return Resolved(filePath, pipeline), nil
	case C.PARCEL_RESOLUTION_EXTERNAL:
		return External(), nil
	case C.PARCEL_RESOLUTION_EXCLUDED:
		return Excluded(), nil
	case C.PARCEL_RESOLUTION_NONE:
		return ResolveResult{}, nil
	default:
		// A kind of resolution this SDK predates, which a plugin cannot act on.
		return ResolveResult{}, failed
	}
}

// writeRaw fills raw, which must be zeroed, with dep. It sets size to what this
// SDK was built with: a field a newer SDK adds lands where an older Parcel
// expects zero bytes, and it rejects anything else there rather than ignore a
// setting it does not understand. Go's zero value covers padding too.
//
// The specifier is pinned, since cgo forbids passing C a struct that holds an
// unpinned pointer into the Go heap.
func (dep *DependencyOptions) writeRaw(raw *C.DependencyOptions, pinner *runtime.Pinner) {
	raw.size = C.sizeof_DependencyOptions
	if len(dep.Specifier) > 0 {
		pinner.Pin(unsafe.StringData(dep.Specifier))
	}
	raw.specifier = stringPtr(dep.Specifier)
	raw.specifier_len = C.uintptr_t(len(dep.Specifier))
	raw.specifier_type = C.uint8_t(dep.SpecifierType)
	raw.priority = C.uint8_t(dep.Priority)
	raw.bundle_behavior = C.uint8_t(dep.BundleBehavior)
	raw.flags = C.uint8_t(dep.Flags)
	raw.conditions = C.uint32_t(dep.Conditions)
	raw.import_type = C.uint8_t(dep.ImportType)
}

// AddExportSymbol registers an exported symbol name (e.g. "default", "foo", "*").
func (a *Asset) AddExportSymbol(name string) {
	if len(name) == 0 {
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(name)))
	C.parcel_asset_add_export_symbol(a.ptr, ptr, C.uintptr_t(len(name)))
}

// ── Dependency ─────────────────────────────────────────────────────────────

// Dependency provides read-only access to a Parcel dependency.
type Dependency struct {
	ptr     C.Dependency
	options C.Options
}

// Specifier returns the raw module specifier (e.g. "custom:greeting").
func (d *Dependency) Specifier() string {
	var buf C.Buffer
	C.parcel_dep_get_specifier(&buf, d.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// SpecifierType returns the specifier type.
func (d *Dependency) SpecifierType() SpecifierType {
	return SpecifierType(C.parcel_dep_get_specifier_type(d.ptr))
}

// Priority returns the dependency priority.
func (d *Dependency) Priority() Priority {
	return Priority(C.parcel_dep_get_priority(d.ptr))
}

// BundleBehavior returns the bundle behavior.
func (d *Dependency) BundleBehavior() BundleBehavior {
	return BundleBehavior(C.parcel_dep_get_bundle_behavior(d.ptr))
}

// Flags returns the raw DependencyFlags bitfield.
func (d *Dependency) Flags() DependencyFlags {
	return DependencyFlags(C.parcel_dep_get_flags(d.ptr))
}

// Conditions returns the package exports and imports conditions bitfield.
func (d *Dependency) Conditions() ExportsConditions {
	return ExportsConditions(C.parcel_dep_get_conditions(d.ptr))
}

// ImportType returns how the importing asset uses the resolved one.
func (d *Dependency) ImportType() ImportType {
	return ImportType(C.parcel_dep_get_import_type(d.ptr))
}

// SourcePath returns the absolute path of the file that contains this import.
func (d *Dependency) SourcePath() string {
	var buf C.Buffer
	C.parcel_dep_get_source_path(&buf, d.ptr, d.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// ResolveFrom returns the base path for resolving the specifier.
func (d *Dependency) ResolveFrom() string {
	var buf C.Buffer
	C.parcel_dep_get_resolve_from(&buf, d.ptr, d.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// Target returns the target configuration for this dependency.
func (d *Dependency) Target() *Target {
	return &Target{ptr: C.parcel_dep_get_target(d.ptr), options: d.options}
}

// ── ResolveResult ───────────────────────────────────────────────────────────

type resolveResultKind uint8

const (
	resolveResultNone resolveResultKind = iota
	resolveResultFilePath
	resolveResultExternal
	resolveResultExcluded
)

// ResolveResult is the outcome of resolving a dependency. Its zero value
// continues to the next resolver.
type ResolveResult struct {
	kind     resolveResultKind
	filePath string
	pipeline string
}

// Resolved returns a result for an absolute file path and optional transformer
// pipeline. Pass an empty pipeline when no pipeline is needed.
func Resolved(filePath, pipeline string) ResolveResult {
	return ResolveResult{
		kind:     resolveResultFilePath,
		filePath: filePath,
		pipeline: pipeline,
	}
}

// External returns a result that marks the dependency as external (not bundled).
func External() ResolveResult {
	return ResolveResult{kind: resolveResultExternal}
}

// Excluded returns a result that silently excludes the dependency from the bundle.
func Excluded() ResolveResult {
	return ResolveResult{kind: resolveResultExcluded}
}

// FilePath returns the resolved absolute file path, and false when the result
// is not a file.
func (r ResolveResult) FilePath() (string, bool) {
	return r.filePath, r.kind == resolveResultFilePath
}

// Pipeline returns the transformer pipeline the resolver chose for a file, or "".
func (r ResolveResult) Pipeline() string {
	return r.pipeline
}

// IsExternal reports whether the dependency is external (not bundled).
func (r ResolveResult) IsExternal() bool {
	return r.kind == resolveResultExternal
}

// IsExcluded reports whether the dependency is excluded from the bundle.
func (r ResolveResult) IsExcluded() bool {
	return r.kind == resolveResultExcluded
}

func writeResolveResult(raw *C.ResolveResult, result ResolveResult) {
	if raw == nil {
		return
	}

	// Parcel allocated raw and set its size, so it is written field by field,
	// leaving size alone. Every field here is in the first layout; a field added later must
	// check raw.size before writing it.
	raw.resolution_type = C.ResolutionType(result.kind)
	writeBuffer := func(buf *C.Buffer, value string) {
		if len(value) == 0 {
			return
		}
		data := []byte(value)
		*buf = C.parcel_buffer_alloc((*C.uint8_t)(unsafe.Pointer(&data[0])), C.uintptr_t(len(data)))
	}

	if result.kind == resolveResultFilePath {
		writeBuffer(&raw.file_path, result.filePath)
		writeBuffer(&raw.pipeline, result.pipeline)
	}
}

// ── Target ─────────────────────────────────────────────────────────────────

// Target holds read-only information about the build target for an asset.
type Target struct {
	ptr     C.Target
	options C.Options
}

// Environment returns the target execution environment.
func (t *Target) Environment() Environment {
	return Environment(C.parcel_target_get_environment(t.ptr))
}

// OutputFormat returns the output module format.
func (t *Target) OutputFormat() OutputFormat {
	return OutputFormat(C.parcel_target_get_output_format(t.ptr))
}

// SourceType returns whether the target expects module or script source.
func (t *Target) SourceType() SourceType {
	return SourceType(C.parcel_target_get_source_type(t.ptr))
}

// EnvFlags returns the environment flags bitfield.
func (t *Target) EnvFlags() EnvironmentFlags {
	return EnvironmentFlags(C.parcel_target_get_env_flags(t.ptr))
}

// PublicURL returns the public URL (e.g. "/" or "https://cdn.example.com/").
func (t *Target) PublicURL() string {
	var buf C.Buffer
	C.parcel_target_get_public_url(&buf, t.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// DistDir returns the absolute path of the dist directory.
func (t *Target) DistDir() string {
	var buf C.Buffer
	C.parcel_target_get_dist_dir(&buf, t.ptr, t.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// ── Diagnostic ─────────────────────────────────────────────────────────────

// DiagnosticSeverity controls how a plugin diagnostic is treated.
type DiagnosticSeverity uint8

const (
	SeverityError       DiagnosticSeverity = 0
	SeverityWarning     DiagnosticSeverity = 1
	SeveritySourceError DiagnosticSeverity = 2
	SeverityInfo        DiagnosticSeverity = 3
)

// Diagnostic is a structured error or warning returned by a plugin.
// It implements the error interface so it can be returned directly from
// transform and resolve functions.
//
// Example:
//
//	return &parcel.Diagnostic{
//	    Message:  "unsupported syntax",
//	    FilePath: asset.FilePath(),
//	    Line:     10,
//	    Column:   5,
//	    Hint:     "remove the unsupported feature",
//	}
type Diagnostic struct {
	Message  string
	Severity DiagnosticSeverity
	// FilePath is an optional absolute path for a source code frame.
	FilePath string
	// Line is the 1-based start line for a code highlight (0 = not set).
	Line uint32
	// Column is the 1-based start column (0 = not set).
	Column uint32
	// EndLine and EndColumn are the 1-based position of the last highlighted
	// character (0 = highlight just the start).
	EndLine   uint32
	EndColumn uint32
	// HighlightMessage is an optional message shown at the code highlight.
	HighlightMessage string
	// Hint is an optional hint string.
	Hint string
	// DocumentationURL optionally links to documentation about the diagnostic.
	DocumentationURL string

	// parcelDiagnostics are diagnostics Parcel reported during this call, such
	// as why a read failed, which this diagnostic stands for. Returned from a
	// plugin method, it fails with exactly those, and none of its other fields
	// are reported.
	parcelDiagnostics C.Diagnostics
}

// parcelDiagnosticsError stands for the diagnostics Parcel reported in list. Its
// message is the first one's, for printing, or fallback when there are none.
func parcelDiagnosticsError(list C.Diagnostics, fallback string) *Diagnostic {
	if list == 0 {
		return &Diagnostic{Message: fallback}
	}
	var buf C.Buffer
	C.parcel_diagnostic_get_message(&buf, list, 0)
	return &Diagnostic{Message: takeBufferString(&buf), parcelDiagnostics: list}
}

// Error implements the error interface.
func (d *Diagnostic) Error() string { return d.Message }

// ── Types ──────────────────────────────────────────────────────────────────

// BundleBehavior controls how the asset's bundle is output.
type BundleBehavior uint8

const (
	BundleBehaviorNone     BundleBehavior = 0
	BundleBehaviorInline   BundleBehavior = 1
	BundleBehaviorIsolated BundleBehavior = 2
)

// SpecifierType describes how a dependency specifier is interpreted.
type SpecifierType uint8

const (
	SpecifierTypeESM      SpecifierType = 0
	SpecifierTypeCommonJS SpecifierType = 1
	SpecifierTypeURL      SpecifierType = 2
	SpecifierTypeCustom   SpecifierType = 3
)

// Priority determines when the dependency is loaded.
type Priority uint8

const (
	PrioritySync     Priority = 0
	PriorityParallel Priority = 1
	PriorityLazy     Priority = 2
)

// ImportType is what a dependency evaluates to in the code that imports it. A file
// imported as ImportTypeJavaScript, the default, must have a transformer that turns it
// into JavaScript, or it is an error. Other import types, such as ImportTypeURL, can
// reference any file.
type ImportType uint8

const (
	ImportTypeJavaScript ImportType = 0
	ImportTypeStyleSheet ImportType = 1
	ImportTypeURL        ImportType = 2
	ImportTypeText       ImportType = 3
	ImportTypeBytes      ImportType = 4
)

// AssetFlags is a bitfield of asset state flags.
type AssetFlags uint32

const (
	AssetFlagIsSource            AssetFlags = 1 << 0
	AssetFlagSideEffects         AssetFlags = 1 << 1
	AssetFlagIsBundleSplittable  AssetFlags = 1 << 2
	AssetFlagLargeBlob           AssetFlags = 1 << 3
	AssetFlagHasCJSExports       AssetFlags = 1 << 4
	AssetFlagStaticExports       AssetFlags = 1 << 5
	AssetFlagShouldWrap          AssetFlags = 1 << 6
	AssetFlagIsConstantModule    AssetFlags = 1 << 7
	AssetFlagHasNodeReplacements AssetFlags = 1 << 8
	AssetFlagHasSymbols          AssetFlags = 1 << 9
	AssetFlagIsHTMLAttr          AssetFlags = 1 << 10
	AssetFlagIsHTMLTag           AssetFlags = 1 << 11
	AssetFlagIsESM               AssetFlags = 1 << 12
)

// DependencyFlags is a bitfield of dependency flags.
type DependencyFlags uint8

const (
	DependencyFlagEntry           DependencyFlags = 1 << 0
	DependencyFlagOptional        DependencyFlags = 1 << 1
	DependencyFlagNeedsStableName DependencyFlags = 1 << 2
	DependencyFlagIsWebWorker     DependencyFlags = 1 << 3
	DependencyFlagSideEffects     DependencyFlags = 1 << 4
	DependencyFlagMacro           DependencyFlags = 1 << 5
)

// ExportsConditions is a bitfield of conditions used when resolving package
// exports and imports fields.
type ExportsConditions uint32

const (
	ExportsConditionImport      ExportsConditions = 1 << 0
	ExportsConditionRequire     ExportsConditions = 1 << 1
	ExportsConditionModule      ExportsConditions = 1 << 2
	ExportsConditionNode        ExportsConditions = 1 << 3
	ExportsConditionBrowser     ExportsConditions = 1 << 4
	ExportsConditionWorker      ExportsConditions = 1 << 5
	ExportsConditionWorklet     ExportsConditions = 1 << 6
	ExportsConditionElectron    ExportsConditions = 1 << 7
	ExportsConditionDevelopment ExportsConditions = 1 << 8
	ExportsConditionProduction  ExportsConditions = 1 << 9
	ExportsConditionTypes       ExportsConditions = 1 << 10
	ExportsConditionDefault     ExportsConditions = 1 << 11
	ExportsConditionStyle       ExportsConditions = 1 << 12
	ExportsConditionSass        ExportsConditions = 1 << 13
	ExportsConditionLess        ExportsConditions = 1 << 14
	ExportsConditionStylus      ExportsConditions = 1 << 15
	ExportsConditionReactServer ExportsConditions = 1 << 16
	ExportsConditionSource      ExportsConditions = 1 << 17
)

// DependencyOptions describes a dependency to be added from a transformer.
type DependencyOptions struct {
	Specifier      string
	SpecifierType  SpecifierType
	Priority       Priority
	BundleBehavior BundleBehavior
	Flags          DependencyFlags
	Conditions     ExportsConditions
	ImportType     ImportType
}

// Environment represents the target execution environment.
type Environment uint8

const (
	EnvironmentBrowser          Environment = 0
	EnvironmentWebWorker        Environment = 1
	EnvironmentServiceWorker    Environment = 2
	EnvironmentWorklet          Environment = 3
	EnvironmentNode             Environment = 4
	EnvironmentElectronMain     Environment = 5
	EnvironmentElectronRenderer Environment = 6
	EnvironmentReactClient      Environment = 7
	EnvironmentReactServer      Environment = 8
)

// OutputFormat represents the output module format.
type OutputFormat uint8

const (
	OutputFormatGlobal   OutputFormat = 0
	OutputFormatCommonJS OutputFormat = 1
	OutputFormatESModule OutputFormat = 2
)

// SourceType indicates whether the target expects ES module or script source.
type SourceType uint8

const (
	SourceTypeModule SourceType = 0
	SourceTypeScript SourceType = 1
)

// ── Reporter events ─────────────────────────────────────────────────────────

// LogLevel is the level of a log event, and of a message passed to
// [Options.Log].
type LogLevel uint8

const (
	LogNone    LogLevel = 0
	LogError   LogLevel = 1
	LogWarn    LogLevel = 2
	LogInfo    LogLevel = 3
	LogVerbose LogLevel = 4
)

// String returns the level's lowercase name.
func (l LogLevel) String() string {
	switch l {
	case LogError:
		return "error"
	case LogWarn:
		return "warn"
	case LogInfo:
		return "info"
	case LogVerbose:
		return "verbose"
	}
	return "unknown"
}

// ReportEvent is something that happened during the build, passed to
// [Plugin.Report]. Switch on its concrete type to handle the events you care
// about:
//
//	switch event := event.(type) {
//	case *parcel.BuildSuccess:
//	    fmt.Println(event.BundleGraph.BundleCount(), event.BuildTime)
//	case *parcel.BuildFailure:
//	    for _, d := range event.Diagnostics.All() { fmt.Println(d.Message()) }
//	}
//
// The set is closed — only this package can add events to it — so a switch that
// handles every case today keeps compiling when Parcel adds one, and reports
// nothing for it. Everything an event points at is valid only for the duration
// of the Report call it was passed to.
type ReportEvent interface {
	isReportEvent()
}

// BuildStart reports that a build is about to start. Emitted once per build,
// including rebuilds.
type BuildStart struct{}

// BuildSuccess reports a build that finished and wrote its output.
type BuildSuccess struct {
	BundleGraph *BundleGraph
	// BuildTime is how long the build took.
	BuildTime time.Duration
	// ChangedAssets holds the assets transformed by this build. On a full build,
	// that is every asset.
	ChangedAssets []AssetIndex
}

// BuildFailure reports a build that failed. The same diagnostics are returned
// to whoever asked for the build.
type BuildFailure struct {
	Diagnostics *Diagnostics
}

// Log reports a message from Parcel or from another plugin.
type Log struct {
	Level LogLevel
	// Message is empty when the event carries diagnostics instead.
	Message string
	// Diagnostics is nil when the event carries a message instead.
	Diagnostics *Diagnostics
}

func (*BuildStart) isReportEvent()   {}
func (*BuildSuccess) isReportEvent() {}
func (*BuildFailure) isReportEvent() {}
func (*Log) isReportEvent()          {}

// Diagnostics is the list of diagnostics a [ReportEvent] carries.
type Diagnostics struct {
	ptr C.DiagnosticsRef
}

// Len returns how many diagnostics the event carries.
func (d *Diagnostics) Len() int {
	if d == nil || d.ptr == 0 {
		return 0
	}
	return int(C.parcel_diagnostics_get_count(d.ptr))
}

// At returns the diagnostic at index, and false if index is out of range.
func (d *Diagnostics) At(index int) (DiagnosticInfo, bool) {
	if index < 0 || index >= d.Len() {
		return DiagnosticInfo{}, false
	}
	return DiagnosticInfo{diagnostics: d.ptr, index: C.uintptr_t(index)}, true
}

// All returns every diagnostic in the list.
func (d *Diagnostics) All() []DiagnosticInfo {
	count := d.Len()
	out := make([]DiagnosticInfo, 0, count)
	for index := 0; index < count; index++ {
		if info, ok := d.At(index); ok {
			out = append(out, info)
		}
	}
	return out
}

// DiagnosticInfo is one diagnostic within a [Diagnostics] list.
type DiagnosticInfo struct {
	diagnostics C.DiagnosticsRef
	index       C.uintptr_t
}

// Message returns the diagnostic's message.
func (d DiagnosticInfo) Message() string {
	var buf C.Buffer
	C.parcel_diagnostic_get_message(&buf, d.diagnostics, d.index)
	return takeBufferString(&buf)
}

// Severity returns the diagnostic's severity.
func (d DiagnosticInfo) Severity() DiagnosticSeverity {
	return DiagnosticSeverity(C.parcel_diagnostic_get_severity(d.diagnostics, d.index))
}

// Origin returns the name of the plugin the diagnostic came from, or an empty
// string when it recorded none.
func (d DiagnosticInfo) Origin() string {
	var buf C.Buffer
	C.parcel_diagnostic_get_origin(&buf, d.diagnostics, d.index)
	return takeBufferString(&buf)
}

// Hints returns the diagnostic's hints.
func (d DiagnosticInfo) Hints() []string {
	count := int(C.parcel_diagnostic_get_hint_count(d.diagnostics, d.index))
	out := make([]string, 0, count)
	for hint := 0; hint < count; hint++ {
		var buf C.Buffer
		C.parcel_diagnostic_get_hint(&buf, d.diagnostics, d.index, C.uintptr_t(hint))
		out = append(out, takeBufferString(&buf))
	}
	return out
}

// DocumentationURL returns a URL to documentation about the diagnostic, or ""
// when it has none.
func (d DiagnosticInfo) DocumentationURL() string {
	var buf C.Buffer
	C.parcel_diagnostic_get_documentation_url(&buf, d.diagnostics, d.index)
	return takeBufferString(&buf)
}

// CodeFrame is an excerpt of a file a diagnostic is about, with parts of it
// highlighted.
type CodeFrame struct {
	// FilePath is the absolute path of the file, when it is one on disk.
	FilePath string
	// URL is the URL of the file, e.g. a file: URL, when the frame names one.
	URL string
	// Code is the code to show, when it differs from the file's contents.
	Code string
	// Language is the code's language, as a file extension, when known.
	Language   string
	Highlights []CodeHighlight
}

// CodeHighlight is a highlighted range in a [CodeFrame]. Lines and columns are
// 1-based, and the end is the last highlighted character.
type CodeHighlight struct {
	StartLine   uint32
	StartColumn uint32
	EndLine     uint32
	EndColumn   uint32
	// Message is shown at the highlight, when set.
	Message string
}

// CodeFrames returns excerpts of the files the diagnostic is about, with parts
// of them highlighted. Empty when it has none.
func (d DiagnosticInfo) CodeFrames() []CodeFrame {
	count := int(C.parcel_diagnostic_get_code_frame_count(d.diagnostics, d.index))
	frames := make([]CodeFrame, 0, count)
	for frame := 0; frame < count; frame++ {
		var info C.CodeFrameInfo
		info.size = C.sizeof_CodeFrameInfo
		if !C.parcel_diagnostic_get_code_frame(&info, d.diagnostics, d.index, C.uintptr_t(frame)) {
			continue
		}
		codeFrame := CodeFrame{
			FilePath:   takeBufferString(&info.file_path),
			URL:        takeBufferString(&info.url),
			Code:       takeBufferString(&info.code),
			Language:   takeBufferString(&info.language),
			Highlights: make([]CodeHighlight, 0, int(info.highlight_count)),
		}
		for highlight := 0; highlight < int(info.highlight_count); highlight++ {
			var raw C.CodeHighlightInfo
			raw.size = C.sizeof_CodeHighlightInfo
			if !C.parcel_diagnostic_get_code_highlight(&raw, d.diagnostics, d.index, C.uintptr_t(frame), C.uintptr_t(highlight)) {
				continue
			}
			codeFrame.Highlights = append(codeFrame.Highlights, CodeHighlight{
				StartLine:   uint32(raw.start_line),
				StartColumn: uint32(raw.start_column),
				EndLine:     uint32(raw.end_line),
				EndColumn:   uint32(raw.end_column),
				Message:     takeBufferString(&raw.message),
			})
		}
		frames = append(frames, codeFrame)
	}
	return frames
}

// takeBufferString copies a host-filled buffer into a Go string and frees it.
// goString copies n bytes at p into a Go string. Unlike C.GoStringN, whose
// length is a C int, it copies content of any size.
func goString(p unsafe.Pointer, n uintptr) string {
	if p == nil || n == 0 {
		return ""
	}
	return string(unsafe.Slice((*byte)(p), n))
}

// goBytes copies n bytes at p into a Go slice. Unlike C.GoBytes, whose length is
// a C int, it copies content of any size.
func goBytes(p unsafe.Pointer, n uintptr) []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), unsafe.Slice((*byte)(p), n)...)
}

func takeBufferString(buf *C.Buffer) string {
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// ── Options ─────────────────────────────────────────────────────────────────

// Options is the context of the current plugin call: the build's options, and
// what the call may do, such as read files Parcel tracks. Every plugin method
// receives one, valid until the method returns.
type Options struct {
	ptr C.Options
}

// ProjectRoot returns the absolute project root path.
func (o *Options) ProjectRoot() string {
	var buf C.Buffer
	C.parcel_options_get_project_root(&buf, o.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// Env looks up key in the build environment map. Returns an empty string and
// false if the key is not set.
func (o *Options) Env(key string) (string, bool) {
	if len(key) == 0 {
		return "", false
	}
	var buf C.Buffer
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(key)))
	C.parcel_options_get_env(&buf, o.ptr, ptr, C.uintptr_t(len(key)))
	if buf.data == nil {
		return "", false
	}
	defer C.parcel_free_buffer(&buf)
	return goString(unsafe.Pointer(buf.data), uintptr(buf.len)), true
}

// BuildMode is the mode a build runs in: BuildModeDevelopment,
// BuildModeProduction, or a custom mode the build was given.
type BuildMode string

const (
	BuildModeDevelopment BuildMode = "development"
	BuildModeProduction  BuildMode = "production"
)

// Mode returns the build mode.
func (o *Options) Mode() BuildMode {
	var buf C.Buffer
	C.parcel_options_get_mode(&buf, o.ptr)
	return BuildMode(takeBufferString(&buf))
}

// HMR reports whether hot module replacement is enabled for the build.
func (o *Options) HMR() bool {
	return bool(C.parcel_options_get_hmr(o.ptr))
}

// LogLevel returns the build's log level. Messages below it are dropped, so a
// plugin can skip formatting them.
func (o *Options) LogLevel() LogLevel {
	return LogLevel(C.parcel_options_get_log_level(o.ptr))
}

// Log sends a message to whatever reporters the build has configured.
//
// Available from every plugin method, not just [Plugin.Report]. The message is
// dropped when the build has no reporters, or when level is below its log level.
func (o *Options) Log(level LogLevel, message string) {
	if len(message) == 0 {
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(message)))
	C.parcel_options_log(o.ptr, C.LogLevel(level), ptr, C.uintptr_t(len(message)))
}

// LogDiagnostic sends a diagnostic to the build's reporters without failing the
// build — how a plugin raises a warning, as opposed to returning it as an error,
// which ends the build.
//
// The log level comes from the diagnostic's own Severity.
func (o *Options) LogDiagnostic(diagnostic *Diagnostic) {
	if diagnostic == nil {
		return
	}
	// Ours to allocate this time: zeroed, with the size this SDK was built with.
	var raw C.DiagnosticOptions
	raw.size = C.sizeof_DiagnosticOptions
	writeDiagnostic(&raw, diagnostic)
	// The host copies what it needs rather than taking ownership, unlike the
	// diagnostic a plugin returns as an error, so these are ours to free.
	defer C.parcel_free_buffer(&raw.message)
	defer C.parcel_free_buffer(&raw.file_path)
	defer C.parcel_free_buffer(&raw.hint)
	defer C.parcel_free_buffer(&raw.highlight_message)
	defer C.parcel_free_buffer(&raw.documentation_url)
	C.parcel_options_log_diagnostic(o.ptr, &raw)
}

// FileKind describes what a path refers to. Zero when it does not exist.
type FileKind uint8

const (
	FileKindFile    FileKind = 1 << 0
	FileKindDir     FileKind = 1 << 1
	FileKindSymlink FileKind = 1 << 2
)

// ReadFile reads the file at the absolute path.
//
// Read files through this rather than the os package: Parcel records the path,
// so a change to the file re-runs the transform that read it, and a file that was
// missing re-runs it when created. Only available while transforming or
// resolving. A missing file returns an error matching [fs.ErrNotExist].
func (o *Options) ReadFile(path string) ([]byte, error) {
	var buf C.Buffer
	status := C.parcel_fs_read_file(&buf, o.ptr, stringPtr(path), C.uintptr_t(len(path)))
	if err := ioError(status, &buf, path); err != nil {
		return nil, err
	}
	return bufferBytes(&buf), nil
}

// FileKind returns what the absolute path refers to, or zero when it does not
// exist. Tracked like [Options.ReadFile]: a missing path re-runs the transform
// when created, an existing one when deleted.
func (o *Options) FileKind(path string) FileKind {
	return FileKind(C.parcel_fs_get_kind(o.ptr, stringPtr(path), C.uintptr_t(len(path))))
}

// Canonicalize returns the absolute path with every symlink resolved.
func (o *Options) Canonicalize(path string) (string, error) {
	var buf C.Buffer
	status := C.parcel_fs_canonicalize(&buf, o.ptr, stringPtr(path), C.uintptr_t(len(path)))
	if err := ioError(status, &buf, path); err != nil {
		return "", err
	}
	return string(bufferBytes(&buf)), nil
}

// stringPtr returns a pointer to the bytes of s, or nil when it is empty.
func stringPtr(s string) *C.uint8_t {
	if len(s) == 0 {
		return nil
	}
	return (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(s)))
}

// bufferBytes copies a host-filled buffer into Go memory and frees it, leaving
// it empty so it cannot be freed twice.
func bufferBytes(buf *C.Buffer) []byte {
	if buf.data == nil {
		return nil
	}
	defer func() {
		C.parcel_free_buffer(buf)
		*buf = C.Buffer{}
	}()
	return goBytes(unsafe.Pointer(buf.data), uintptr(buf.len))
}

// ioError converts the status of a host file system call, and consumes the
// buffer unless it is PARCEL_IO_OK. On PARCEL_IO_ERROR the buffer holds the
// message. Any other status is one this SDK predates, reported as a generic
// error with whatever message the buffer holds.
func ioError(status C.IoStatus, buf *C.Buffer, path string) error {
	switch status {
	case C.PARCEL_IO_OK:
		return nil
	case C.PARCEL_IO_NOT_FOUND:
		bufferBytes(buf)
		return &fs.PathError{Op: "open", Path: path, Err: fs.ErrNotExist}
	default:
		message := string(bufferBytes(buf))
		if message == "" {
			return &fs.PathError{Op: "open", Path: path, Err: fmt.Errorf("file system error %d", status)}
		}
		return errors.New(message)
	}
}

// EnvironmentFlags is a bitfield of target environment flags.
type EnvironmentFlags uint8

const (
	EnvFlagIsLibrary           EnvironmentFlags = 1 << 0
	EnvFlagShouldOptimize      EnvironmentFlags = 1 << 1
	EnvFlagShouldScopeHoist    EnvironmentFlags = 1 << 2
	EnvFlagModuleTypeExtension EnvironmentFlags = 1 << 3
)
