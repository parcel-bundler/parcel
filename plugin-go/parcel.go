// Package parcel provides an idiomatic Go API for building Parcel transformer,
// resolver, and namer plugins. Plugins import this package, register a plugin
// with [RegisterPlugin], and export the compiled shared library:
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
#include "plugin.h"

#cgo darwin LDFLAGS: -Wl,-undefined,dynamic_lookup
#cgo linux  LDFLAGS: -Wl,--allow-shlib-undefined
*/
import "C"
import (
	"errors"
	"fmt"
	"runtime/cgo"
	"unsafe"
)

// Plugin is the interface that transformer, resolver, and namer plugins implement.
// Override Transform to act as a transformer, Resolve to act as a resolver,
// Name to act as a namer, or any combination. Embed [DefaultPlugin] to get
// error-returning defaults for whichever
// methods you don't need.
type Plugin interface {
	Transform(asset *Asset, options *Options) error
	Resolve(dep *Dependency, specifier, pipeline string, options *Options, result *ResolveResult) error
	Name(bundleGraph *BundleGraph, bundle *Bundle, options *Options) (string, error)
}

// DefaultPlugin provides error-returning default implementations of [Plugin].
// Embed it in your plugin struct to avoid implementing methods you don't need:
//
//	type MyPlugin struct {
//	    parcel.DefaultPlugin
//	    prefix string
//	}
//
//	func (p *MyPlugin) Transform(asset *parcel.Asset) error { ... }
type DefaultPlugin struct{}

func (DefaultPlugin) Transform(*Asset, *Options) error {
	return errors.New("transform not implemented")
}

func (DefaultPlugin) Resolve(*Dependency, string, string, *Options, *ResolveResult) error {
	return errors.New("resolve not implemented")
}

// Name returns a path relative to the bundle target's dist directory. An empty
// string allows the next namer in the configured pipeline to run.
func (DefaultPlugin) Name(*BundleGraph, *Bundle, *Options) (string, error) {
	return "", errors.New("name not implemented")
}

// pluginFactory is the registered plugin factory function.
var pluginFactory func([]byte) (Plugin, error)

// RegisterPlugin sets the factory that Parcel calls once when the plugin is
// loaded.  The factory receives the JSON-encoded plugin config and returns a
// Plugin instance whose Transform and/or Resolve methods Parcel calls for each
// matching asset or dependency.
// Call RegisterPlugin once from an init() function in your plugin's main package.
func RegisterPlugin(factory func([]byte) (Plugin, error)) {
	pluginFactory = factory
}

//export parcel_plugin_init
func parcel_plugin_init(config *C.uint8_t, configLen C.uintptr_t, diag *C.Diagnostic) (state unsafe.Pointer) {
	defer func() {
		if value := recover(); value != nil {
			state = nil
			writeDiagnostic(diag, panicError("init", value))
		}
	}()
	if pluginFactory == nil {
		return nil
	}
	var data []byte
	if configLen > 0 && config != nil {
		data = C.GoBytes(unsafe.Pointer(config), C.int(configLen))
	}
	plugin, err := pluginFactory(data)
	if err != nil {
		writeDiagnostic(diag, err)
		return nil
	}
	// Store the Plugin interface value in a cgo.Handle so it can safely
	// round-trip through C memory. The handle ID lives in a C-allocated block
	// to avoid go vet's uintptr→unsafe.Pointer warning (cgo.Handle is an
	// integer, not a GC pointer, but the tool cannot distinguish the two).
	handle := cgo.NewHandle(plugin)
	p := (*C.uintptr_t)(C.malloc(C.size_t(unsafe.Sizeof(C.uintptr_t(0)))))
	*p = C.uintptr_t(handle)
	return unsafe.Pointer(p)
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
func parcel_plugin_transform(asset C.Asset, rawOptions C.Options, state unsafe.Pointer, diag *C.Diagnostic) {
	defer recoverDiagnostic("transform", diag)
	if state == nil {
		writeDiagnostic(diag, errors.New("plugin not registered: call parcel.RegisterPlugin in init()"))
		return
	}
	plugin := cgo.Handle(*(*C.uintptr_t)(state)).Value().(Plugin)
	a := &Asset{ptr: asset, options: rawOptions}
	opts := &Options{ptr: rawOptions}
	if err := plugin.Transform(a, opts); err != nil {
		writeDiagnostic(diag, err)
	}
}

//export parcel_plugin_resolve
func parcel_plugin_resolve(dep C.Dependency, specifier *C.uint8_t, specifierLen C.uintptr_t, pipeline *C.uint8_t, pipelineLen C.uintptr_t, rawOptions C.Options, result *C.ResolveResult, state unsafe.Pointer, diag *C.Diagnostic) {
	defer recoverDiagnostic("resolve", diag)
	if state == nil {
		writeDiagnostic(diag, errors.New("plugin not registered: call parcel.RegisterPlugin in init()"))
		return
	}
	plugin := cgo.Handle(*(*C.uintptr_t)(state)).Value().(Plugin)
	d := &Dependency{ptr: C.Dependency(dep), options: rawOptions}
	spec := C.GoStringN((*C.char)(unsafe.Pointer(specifier)), C.int(specifierLen))
	pipe := C.GoStringN((*C.char)(unsafe.Pointer(pipeline)), C.int(pipelineLen))
	opts := &Options{ptr: rawOptions}
	r := &ResolveResult{ptr: result}
	if err := plugin.Resolve(d, spec, pipe, opts, r); err != nil {
		writeDiagnostic(diag, err)
	}
}

//export parcel_plugin_name
func parcel_plugin_name(rawGraph C.BundleGraph, rawBundle C.Bundle, rawOptions C.Options, result *C.Buffer, state unsafe.Pointer, diag *C.Diagnostic) {
	defer recoverDiagnostic("name", diag)
	if state == nil {
		writeDiagnostic(diag, errors.New("plugin not registered: call parcel.RegisterPlugin in init()"))
		return
	}
	plugin := cgo.Handle(*(*C.uintptr_t)(state)).Value().(Plugin)
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
		C.parcel_buffer_write_utf8(result, ptr, C.uintptr_t(len(name)))
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

func recoverDiagnostic(scope string, diagnostic *C.Diagnostic) {
	if value := recover(); value != nil {
		writeDiagnostic(diagnostic, panicError(scope, value))
	}
}

func recoverCleanupPanic() {
	_ = recover()
}

// writeDiagnostic fills a Diagnostic from an error. If err is a *Diagnostic,
// all fields are copied; otherwise only the message is set.
func writeDiagnostic(raw *C.Diagnostic, err error) {
	if raw == nil || err == nil {
		return
	}
	d, ok := err.(*Diagnostic)
	if !ok {
		d = &Diagnostic{Message: err.Error()}
	}
	writeBuffer := func(buf *C.Buffer, s string) {
		if len(s) == 0 {
			return
		}
		data := []byte(s)
		*buf = C.parcel_buffer_alloc((*C.uint8_t)(unsafe.Pointer(&data[0])), C.uintptr_t(len(data)))
	}
	writeBuffer(&raw.message, d.Message)
	raw.severity = C.uint8_t(d.Severity)
	writeBuffer(&raw.file_path, d.FilePath)
	raw.line = C.uint32_t(d.Line)
	raw.column = C.uint32_t(d.Column)
	writeBuffer(&raw.hint, d.Hint)
}

// Asset represents the asset being transformed. All methods translate directly
// to the corresponding Parcel C ABI calls.
type Asset struct {
	ptr     C.Asset
	options C.Options
}

// Content returns the asset's source bytes as a UTF-8 string.
func (a *Asset) Content() string {
	var buf C.Buffer
	C.parcel_asset_get_content_utf8(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// ContentBytes returns a copy of the asset's raw source bytes.
func (a *Asset) ContentBytes() []byte {
	var buf C.Buffer
	C.parcel_asset_get_content(&buf, a.ptr)
	if buf.data == nil {
		return nil
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoBytes(unsafe.Pointer(buf.data), C.int(buf.len))
}

// SetContent replaces the asset content with the given string.
func (a *Asset) SetContent(content string) {
	if len(content) == 0 {
		empty := byte(0)
		C.parcel_asset_set_content_utf8(a.ptr, (*C.uint8_t)(unsafe.Pointer(&empty)), 0)
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(content)))
	C.parcel_asset_set_content_utf8(a.ptr, ptr, C.uint32_t(len(content)))
}

// SetContentBytes replaces the asset content with the given byte slice.
func (a *Asset) SetContentBytes(content []byte) {
	if len(content) == 0 {
		empty := byte(0)
		C.parcel_asset_set_content(a.ptr, (*C.uint8_t)(unsafe.Pointer(&empty)), 0)
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(&content[0]))
	C.parcel_asset_set_content(a.ptr, ptr, C.uint32_t(len(content)))
}

// Type returns the asset's type extension (e.g. "js", "css", "txt").
func (a *Asset) Type() string {
	var buf C.Buffer
	C.parcel_asset_get_type(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Pipeline returns the named pipeline (empty string if not set).
func (a *Asset) Pipeline() string {
	var buf C.Buffer
	C.parcel_asset_get_pipeline(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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

// AddDependency appends a dependency to the asset.
func (a *Asset) AddDependency(dep DependencySpec) {
	var specPtr *C.uint8_t
	if len(dep.Specifier) > 0 {
		specPtr = (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(dep.Specifier)))
	}
	cDep := C.DependencyOptions{
		specifier:       specPtr,
		specifier_len:   C.uintptr_t(len(dep.Specifier)),
		specifier_type:  C.uint8_t(dep.SpecifierType),
		priority:        C.uint8_t(dep.Priority),
		bundle_behavior: C.uint8_t(dep.BundleBehavior),
		flags:           C.uint8_t(dep.Flags),
		conditions:      C.uint32_t(dep.Conditions),
	}
	C.parcel_asset_add_dependency(a.ptr, &cDep)
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
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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

// SourcePath returns the absolute path of the file that contains this import.
func (d *Dependency) SourcePath() string {
	var buf C.Buffer
	C.parcel_dep_get_source_path(&buf, d.ptr, d.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// ResolveFrom returns the base path for resolving the specifier.
func (d *Dependency) ResolveFrom() string {
	var buf C.Buffer
	C.parcel_dep_get_resolve_from(&buf, d.ptr, d.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Target returns the target configuration for this dependency.
func (d *Dependency) Target() *Target {
	return &Target{ptr: C.parcel_dep_get_target(d.ptr), options: d.options}
}

// ── ResolveResult ───────────────────────────────────────────────────────────

// ResolveResult is used by resolver plugins to record the resolution outcome.
// Call one of SetFilePath, SetExternal, or SetExcluded; or return without
// calling any to pass the dependency to the next resolver.
type ResolveResult struct {
	ptr *C.ResolveResult
}

// SetFilePath records that the specifier resolved to the given absolute path.
// The bytes are copied into a host-allocated Buffer via parcel_buffer_alloc.
func (r *ResolveResult) SetFilePath(path string) {
	r.ptr.resolution_type = 1
	if len(path) == 0 {
		return
	}
	data := []byte(path)
	r.ptr.file_path = C.parcel_buffer_alloc((*C.uint8_t)(unsafe.Pointer(&data[0])), C.uintptr_t(len(data)))
}

// SetPipeline optionally sets a transformer pipeline for the resolved asset.
// The bytes are copied into a host-allocated Buffer via parcel_buffer_alloc.
func (r *ResolveResult) SetPipeline(pipeline string) {
	if len(pipeline) == 0 {
		return
	}
	data := []byte(pipeline)
	r.ptr.pipeline = C.parcel_buffer_alloc((*C.uint8_t)(unsafe.Pointer(&data[0])), C.uintptr_t(len(data)))
}

// SetExternal marks the dependency as external (not bundled).
func (r *ResolveResult) SetExternal() {
	r.ptr.resolution_type = 2
}

// SetExcluded marks the dependency as excluded (silently dropped).
func (r *ResolveResult) SetExcluded() {
	r.ptr.resolution_type = 3
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

// PublicUrl returns the public URL (e.g. "/" or "https://cdn.example.com/").
func (t *Target) PublicUrl() string {
	var buf C.Buffer
	C.parcel_target_get_public_url(&buf, t.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// DistDir returns the absolute path of the dist directory.
func (t *Target) DistDir() string {
	var buf C.Buffer
	C.parcel_target_get_dist_dir(&buf, t.ptr, t.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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
	// Hint is an optional hint string.
	Hint string
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
	SpecifierTypeEsm      SpecifierType = 0
	SpecifierTypeCommonjs SpecifierType = 1
	SpecifierTypeUrl      SpecifierType = 2
	SpecifierTypeCustom   SpecifierType = 3
)

// Priority determines when the dependency is loaded.
type Priority uint8

const (
	PrioritySync     Priority = 0
	PriorityParallel Priority = 1
	PriorityLazy     Priority = 2
)

// AssetFlags is a bitfield of asset state flags.
type AssetFlags uint32

const (
	AssetFlagIsSource            AssetFlags = 1 << 0
	AssetFlagSideEffects         AssetFlags = 1 << 1
	AssetFlagIsBundleSplittable  AssetFlags = 1 << 2
	AssetFlagLargeBlob           AssetFlags = 1 << 3
	AssetFlagHasCjsExports       AssetFlags = 1 << 4
	AssetFlagStaticExports       AssetFlags = 1 << 5
	AssetFlagShouldWrap          AssetFlags = 1 << 6
	AssetFlagIsConstantModule    AssetFlags = 1 << 7
	AssetFlagHasNodeReplacements AssetFlags = 1 << 8
	AssetFlagHasSymbols          AssetFlags = 1 << 9
	AssetFlagIsHtmlAttr          AssetFlags = 1 << 10
	AssetFlagIsHtmlTag           AssetFlags = 1 << 11
	AssetFlagIsEsm               AssetFlags = 1 << 12
)

// DependencyFlags is a bitfield of dependency flags.
type DependencyFlags uint8

const (
	DependencyFlagEntry           DependencyFlags = 1 << 0
	DependencyFlagOptional        DependencyFlags = 1 << 1
	DependencyFlagNeedsStableName DependencyFlags = 1 << 2
	DependencyFlagIsWebworker     DependencyFlags = 1 << 3
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

// DependencySpec describes a dependency to be added from a transformer.
type DependencySpec struct {
	Specifier      string
	SpecifierType  SpecifierType
	Priority       Priority
	BundleBehavior BundleBehavior
	Flags          DependencyFlags
	Conditions     ExportsConditions
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
	OutputFormatCommonjs OutputFormat = 1
	OutputFormatEsmodule OutputFormat = 2
)

// SourceType indicates whether the target expects ES module or script source.
type SourceType uint8

const (
	SourceTypeModule SourceType = 0
	SourceTypeScript SourceType = 1
)

// ── Options ─────────────────────────────────────────────────────────────────

// Options provides read-only access to the Parcel build options.
// Passed to every Transform and Resolve call.
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
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
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
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len)), true
}

// EnvironmentFlags is a bitfield of target environment flags.
type EnvironmentFlags uint8

const (
	EnvFlagIsLibrary           EnvironmentFlags = 1 << 0
	EnvFlagShouldOptimize      EnvironmentFlags = 1 << 1
	EnvFlagShouldScopeHoist    EnvironmentFlags = 1 << 2
	EnvFlagModuleTypeExtension EnvironmentFlags = 1 << 3
)
