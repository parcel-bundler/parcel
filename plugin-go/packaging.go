package parcel

/*
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"crypto/sha256"
	"errors"
	"reflect"
	"runtime/cgo"
	"sync"
	"unicode/utf8"
	"unsafe"
)

// AssetIndex identifies an asset within a BundleGraph.
type AssetIndex uint32

// BundleIndex identifies a bundle within a BundleGraph.
type BundleIndex uintptr

// InvalidAssetIndex is returned by the C ABI when an asset index is absent.
const InvalidAssetIndex AssetIndex = ^AssetIndex(0)

// Content is either UTF-8 string content or arbitrary byte content. The
// unexported method seals the interface to the variants defined by this SDK.
type Content interface {
	isContent()
}

// StringContent is content that Parcel should preserve as UTF-8 text.
type StringContent string

func (StringContent) isContent() {}

// BytesContent is arbitrary binary content.
type BytesContent []byte

func (BytesContent) isContent() {}

// AssetContent stores arbitrary plugin-owned data on an asset and controls how
// that data is read and packaged. Implementations may be called concurrently.
type AssetContent interface {
	Read() (Content, error)
	Package(bundleGraph *BundleGraph, bundle *Bundle, options *Options) (Content, error)
}

type registeredContent struct {
	handle cgo.Handle
	typeID [16]byte
}

var registeredContents sync.Map

func assetContentTypeID(content AssetContent) [16]byte {
	t := reflect.TypeOf(content)
	name := "<nil>"
	if t != nil {
		name = t.PkgPath() + "\x00" + t.String()
	}
	sum := sha256.Sum256([]byte(name))
	var id [16]byte
	copy(id[:], sum[:16])
	return id
}

func registerContent(content AssetContent) (unsafe.Pointer, [16]byte) {
	handle := cgo.NewHandle(content)
	p := C.malloc(C.size_t(unsafe.Sizeof(C.uintptr_t(0))))
	if p == nil {
		handle.Delete()
		panic("parcel: could not allocate custom content handle")
	}
	*(*C.uintptr_t)(p) = C.uintptr_t(handle)
	typeID := assetContentTypeID(content)
	registeredContents.Store(uintptr(p), registeredContent{handle: handle, typeID: typeID})
	return p, typeID
}

func contentForPointer(p unsafe.Pointer) (AssetContent, registeredContent, bool) {
	if p == nil {
		return nil, registeredContent{}, false
	}
	value, ok := registeredContents.Load(uintptr(p))
	if !ok {
		return nil, registeredContent{}, false
	}
	registered := value.(registeredContent)
	content, ok := registered.handle.Value().(AssetContent)
	return content, registered, ok
}

func writeContentBuffer(buf *C.Buffer, content Content) error {
	switch content := content.(type) {
	case StringContent:
		data := string(content)
		if !utf8.ValidString(data) {
			return errors.New("parcel: StringContent contains invalid UTF-8")
		}
		if len(data) > 0 {
			ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(data)))
			C.parcel_buffer_write_utf8(buf, ptr, C.uintptr_t(len(data)))
		}
	case BytesContent:
		if len(content) > 0 {
			ptr := (*C.uint8_t)(unsafe.Pointer(&content[0]))
			C.parcel_buffer_write(buf, ptr, C.uintptr_t(len(content)))
		}
	case nil:
		return errors.New("parcel: AssetContent returned nil Content")
	default:
		return errors.New("parcel: AssetContent returned an unsupported Content implementation")
	}
	return nil
}

//export parcel_go_content_read
func parcel_go_content_read(rawContent unsafe.Pointer, buf *C.Buffer, diagnostic *C.Diagnostic) {
	defer recoverDiagnostic("custom content read", diagnostic)
	content, _, ok := contentForPointer(rawContent)
	if !ok {
		writeDiagnostic(diagnostic, errors.New("parcel: custom content handle is no longer valid"))
		return
	}
	result, err := content.Read()
	if err != nil {
		writeDiagnostic(diagnostic, err)
		return
	}
	if err := writeContentBuffer(buf, result); err != nil {
		writeDiagnostic(diagnostic, err)
	}
}

//export parcel_go_content_package
func parcel_go_content_package(rawContent unsafe.Pointer, rawGraph C.BundleGraph, rawBundle C.Bundle, rawOptions C.Options, buf *C.Buffer, diagnostic *C.Diagnostic) {
	defer recoverDiagnostic("custom content package", diagnostic)
	content, _, ok := contentForPointer(rawContent)
	if !ok {
		writeDiagnostic(diagnostic, errors.New("parcel: custom content handle is no longer valid"))
		return
	}
	result, err := content.Package(
		&BundleGraph{ptr: rawGraph, options: rawOptions},
		&Bundle{ptr: rawBundle, options: rawOptions},
		&Options{ptr: rawOptions},
	)
	if err != nil {
		writeDiagnostic(diagnostic, err)
		return
	}
	if err := writeContentBuffer(buf, result); err != nil {
		writeDiagnostic(diagnostic, err)
	}
}

//export parcel_go_content_free
func parcel_go_content_free(rawContent unsafe.Pointer) {
	defer recoverCleanupPanic()
	if rawContent == nil {
		return
	}
	if value, ok := registeredContents.LoadAndDelete(uintptr(rawContent)); ok {
		C.free(rawContent)
		value.(registeredContent).handle.Delete()
	}
}

// SetCustomContent replaces the asset content with plugin-owned arbitrary data.
// Parcel retains the content until the asset is dropped or its content is replaced.
func (a *Asset) SetCustomContent(content AssetContent) {
	if content == nil {
		panic("parcel: custom content must not be nil")
	}
	rawContent, typeID := registerContent(content)
	C.parcel_go_set_custom_content(
		a.ptr,
		(*C.uint8_t)(unsafe.Pointer(&typeID[0])),
		rawContent,
	)
}

func customContent(rawAsset C.Asset) (AssetContent, bool) {
	var typeID [16]C.uint8_t
	var rawContent unsafe.Pointer
	set := C.parcel_go_get_custom_content(&typeID[0], &rawContent, rawAsset)
	if !set {
		return nil, false
	}
	content, registered, ok := contentForPointer(rawContent)
	if !ok {
		return nil, false
	}
	for i, value := range registered.typeID {
		if byte(typeID[i]) != value {
			return nil, false
		}
	}
	return content, true
}

// CustomContent returns custom content created by this Go SDK.
func (a *Asset) CustomContent() (AssetContent, bool) {
	return customContent(a.ptr)
}

// BundleGraph is a read-only view of the bundle graph during packaging or
// naming. It and all values obtained from it are valid only for the duration of
// the Package or Name call.
type BundleGraph struct {
	ptr     C.BundleGraph
	options C.Options
}

// AssetCount returns the number of assets in the graph.
func (g *BundleGraph) AssetCount() int {
	return int(C.parcel_bundle_graph_get_asset_count(g.ptr))
}

// Asset returns a read-only asset view for index.
func (g *BundleGraph) Asset(index AssetIndex) (*AssetRef, bool) {
	raw := C.parcel_bundle_graph_get_asset(g.ptr, C.AssetIndex(index))
	if raw == 0 {
		return nil, false
	}
	return &AssetRef{ptr: raw, options: g.options, index: index}, true
}

// Assets returns all assets in the graph in index order.
func (g *BundleGraph) Assets() []*AssetRef {
	count := g.AssetCount()
	assets := make([]*AssetRef, 0, count)
	for index := 0; index < count; index++ {
		if asset, ok := g.Asset(AssetIndex(index)); ok {
			assets = append(assets, asset)
		}
	}
	return assets
}

// BundleCount returns the number of bundles in the graph.
func (g *BundleGraph) BundleCount() int {
	return int(C.parcel_bundle_graph_get_bundle_count(g.ptr))
}

// Bundle returns a read-only bundle view for index.
func (g *BundleGraph) Bundle(index BundleIndex) (*Bundle, bool) {
	raw := C.parcel_bundle_graph_get_bundle(g.ptr, C.BundleIndex(index))
	if raw == 0 {
		return nil, false
	}
	return &Bundle{ptr: raw, options: g.options}, true
}

// Bundles returns all bundles in graph order.
func (g *BundleGraph) Bundles() []*Bundle {
	count := g.BundleCount()
	bundles := make([]*Bundle, 0, count)
	for index := 0; index < count; index++ {
		if bundle, ok := g.Bundle(BundleIndex(index)); ok {
			bundles = append(bundles, bundle)
		}
	}
	return bundles
}

// BundleGraphResolutionType describes a dependency's bundle-graph resolution.
type BundleGraphResolutionType uint8

const (
	BundleGraphResolutionInvalid BundleGraphResolutionType = iota
	BundleGraphResolutionNone
	BundleGraphResolutionDeferred
	BundleGraphResolutionExternal
	BundleGraphResolutionExcluded
	BundleGraphResolutionAsset
	BundleGraphResolutionBundle
)

// BundleGraphDependencyResolution is the resolved graph target of a dependency.
// Asset is valid for BundleGraphResolutionAsset; Bundle is valid for
// BundleGraphResolutionBundle.
type BundleGraphDependencyResolution struct {
	Type   BundleGraphResolutionType
	Asset  AssetIndex
	Bundle BundleIndex
}

// DependencyResolution returns the graph resolution for an asset dependency.
func (g *BundleGraph) DependencyResolution(asset AssetIndex, dependencyIndex int) BundleGraphDependencyResolution {
	resolution := C.parcel_bundle_graph_get_dependency_resolution(
		g.ptr,
		C.AssetIndex(asset),
		C.uintptr_t(dependencyIndex),
	)
	return BundleGraphDependencyResolution{
		Type:   BundleGraphResolutionType(resolution.resolution_type),
		Asset:  AssetIndex(resolution.asset),
		Bundle: BundleIndex(resolution.bundle),
	}
}

// AssetRef is a read-only view of an asset in a BundleGraph.
type AssetRef struct {
	ptr     C.Asset
	options C.Options
	index   AssetIndex
}

// Index returns the asset's stable graph index.
func (a *AssetRef) Index() AssetIndex { return a.index }

// Content returns the asset content as a string.
func (a *AssetRef) Content() string {
	var buf C.Buffer
	C.parcel_asset_get_content_utf8(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// ContentBytes returns a copy of the raw asset content.
func (a *AssetRef) ContentBytes() []byte {
	var buf C.Buffer
	C.parcel_asset_get_content(&buf, a.ptr)
	if buf.data == nil {
		return nil
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoBytes(unsafe.Pointer(buf.data), C.int(buf.len))
}

// CustomContent returns custom content created by this Go SDK.
func (a *AssetRef) CustomContent() (AssetContent, bool) {
	return customContent(a.ptr)
}

// Type returns the asset's type extension.
func (a *AssetRef) Type() string {
	var buf C.Buffer
	C.parcel_asset_get_type(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// FilePath returns the absolute filesystem path of the source asset.
func (a *AssetRef) FilePath() string {
	var buf C.Buffer
	C.parcel_asset_get_file_path(&buf, a.ptr, a.options)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Query returns the query string from the asset's source URL.
func (a *AssetRef) Query() string {
	var buf C.Buffer
	C.parcel_asset_get_query(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Pipeline returns the named pipeline, or an empty string if absent.
func (a *AssetRef) Pipeline() string {
	var buf C.Buffer
	C.parcel_asset_get_pipeline(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// BundleBehavior returns the asset's bundle behavior.
func (a *AssetRef) BundleBehavior() BundleBehavior {
	return BundleBehavior(C.parcel_asset_get_bundle_behavior(a.ptr))
}

// Flags returns the asset flags.
func (a *AssetRef) Flags() AssetFlags {
	return AssetFlags(C.parcel_asset_get_flags(a.ptr))
}

// HasFlag reports whether all bits in mask are set.
func (a *AssetRef) HasFlag(mask AssetFlags) bool {
	return a.Flags()&mask == mask
}

// UniqueKey returns the asset's unique key, or an empty string if absent.
func (a *AssetRef) UniqueKey() string {
	var buf C.Buffer
	C.parcel_asset_get_unique_key(&buf, a.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Target returns the asset target.
func (a *AssetRef) Target() *Target {
	return &Target{ptr: C.parcel_asset_get_target(a.ptr), options: a.options}
}

// DependencyCount returns the number of dependencies belonging to the asset.
func (a *AssetRef) DependencyCount() int {
	return int(C.parcel_asset_get_dependency_count(a.ptr))
}

// Dependency returns the dependency at index.
func (a *AssetRef) Dependency(index int) (*Dependency, bool) {
	raw := C.parcel_asset_get_dependency(a.ptr, C.uintptr_t(index))
	if raw == 0 {
		return nil, false
	}
	return &Dependency{ptr: raw, options: a.options}, true
}

// Dependencies returns all dependencies in source order.
func (a *AssetRef) Dependencies() []*Dependency {
	count := a.DependencyCount()
	dependencies := make([]*Dependency, 0, count)
	for index := 0; index < count; index++ {
		if dependency, ok := a.Dependency(index); ok {
			dependencies = append(dependencies, dependency)
		}
	}
	return dependencies
}

// Bundle is a read-only view of a bundle during packaging or naming.
type Bundle struct {
	ptr     C.Bundle
	options C.Options
}

// Type returns the bundle type extension.
func (b *Bundle) Type() string {
	var buf C.Buffer
	C.parcel_bundle_get_type(&buf, b.ptr)
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

// Target returns the bundle target.
func (b *Bundle) Target() *Target {
	return &Target{ptr: C.parcel_bundle_get_target(b.ptr), options: b.options}
}

// BundleBehavior returns the bundle behavior.
func (b *Bundle) BundleBehavior() BundleBehavior {
	return BundleBehavior(C.parcel_bundle_get_bundle_behavior(b.ptr))
}

// BundleFlags is a bitfield describing bundle state.
type BundleFlags uint8

const (
	BundleFlagNeedsStableName BundleFlags = 1 << 0
	BundleFlagIsSplittable    BundleFlags = 1 << 1
	BundleFlagIsPlaceholder   BundleFlags = 1 << 2
	BundleFlagEntry           BundleFlags = 1 << 3
)

// Flags returns the bundle flags.
func (b *Bundle) Flags() BundleFlags {
	return BundleFlags(C.parcel_bundle_get_flags(b.ptr))
}

// HasFlag reports whether all bits in mask are set.
func (b *Bundle) HasFlag(mask BundleFlags) bool {
	return b.Flags()&mask == mask
}

// DistPath returns the absolute output path, if the bundle has been named.
func (b *Bundle) DistPath() (string, bool) {
	var buf C.Buffer
	C.parcel_bundle_get_dist_path(&buf, b.ptr)
	if buf.data == nil {
		return "", false
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len)), true
}

// AssetCount returns the number of assets in the bundle.
func (b *Bundle) AssetCount() int {
	return int(C.parcel_bundle_get_asset_count(b.ptr))
}

// Asset returns the graph asset index at index.
func (b *Bundle) Asset(index int) (AssetIndex, bool) {
	asset := AssetIndex(C.parcel_bundle_get_asset(b.ptr, C.uintptr_t(index)))
	return asset, asset != InvalidAssetIndex
}

// Assets returns all graph asset indices in bundle order.
func (b *Bundle) Assets() []AssetIndex {
	count := b.AssetCount()
	assets := make([]AssetIndex, 0, count)
	for index := 0; index < count; index++ {
		if asset, ok := b.Asset(index); ok {
			assets = append(assets, asset)
		}
	}
	return assets
}

// EntryAssetCount returns the number of entry assets.
func (b *Bundle) EntryAssetCount() int {
	return int(C.parcel_bundle_get_entry_asset_count(b.ptr))
}

// EntryAsset returns the graph asset index for an entry asset.
func (b *Bundle) EntryAsset(index int) (AssetIndex, bool) {
	asset := AssetIndex(C.parcel_bundle_get_entry_asset(b.ptr, C.uintptr_t(index)))
	return asset, asset != InvalidAssetIndex
}

// EntryAssets returns all graph entry asset indices.
func (b *Bundle) EntryAssets() []AssetIndex {
	count := b.EntryAssetCount()
	assets := make([]AssetIndex, 0, count)
	for index := 0; index < count; index++ {
		if asset, ok := b.EntryAsset(index); ok {
			assets = append(assets, asset)
		}
	}
	return assets
}

// MainEntryAsset returns the main entry asset index, if present.
func (b *Bundle) MainEntryAsset() (AssetIndex, bool) {
	asset := AssetIndex(C.parcel_bundle_get_main_entry_asset(b.ptr))
	return asset, asset != InvalidAssetIndex
}

func bundleString(call func(*C.Buffer)) (string, bool) {
	var buf C.Buffer
	call(&buf)
	if buf.data == nil {
		return "", false
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len)), true
}

// Name returns the dist-relative bundle name, if named.
func (b *Bundle) Name() (string, bool) {
	return bundleString(func(buf *C.Buffer) { C.parcel_bundle_get_name(buf, b.ptr) })
}

// AbsoluteURL returns the public bundle URL, if named.
func (b *Bundle) AbsoluteURL() (string, bool) {
	return bundleString(func(buf *C.Buffer) { C.parcel_bundle_get_absolute_url(buf, b.ptr) })
}

// RelativeURL returns this bundle's URL relative to from.
func (b *Bundle) RelativeURL(from *Bundle) (string, bool) {
	if from == nil {
		return "", false
	}
	return bundleString(func(buf *C.Buffer) {
		C.parcel_bundle_get_relative_url(buf, b.ptr, from.ptr)
	})
}

// RelativeSpecifier returns this bundle's module specifier relative to from.
func (b *Bundle) RelativeSpecifier(from *Bundle) (string, bool) {
	if from == nil {
		return "", false
	}
	return bundleString(func(buf *C.Buffer) {
		C.parcel_bundle_get_relative_specifier(buf, b.ptr, from.ptr)
	})
}
