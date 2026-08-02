package parcel

import (
	"errors"
	"strings"
	"testing"
	"unsafe"
)

type panickingPlugin struct {
	DefaultPlugin
}

func (*panickingPlugin) Transform(*Asset, *Options) error {
	panic("transform panic")
}

func (*panickingPlugin) Resolve(*Dependency, string, string, *Options) (ResolveResult, error) {
	panic(errors.New("resolve panic"))
}

func (*panickingPlugin) Name(*BundleGraph, *Bundle, *Options) (string, error) {
	panic("name panic")
}

func (*panickingPlugin) Optimize(*BundleGraph, *Bundle, []byte, []byte, *Options) (OptimizeResult, error) {
	panic("optimize panic")
}

type panickingContent struct{}

func (*panickingContent) Read() (Content, error) {
	panic("content read panic")
}

func (*panickingContent) Package(*BundleGraph, *Bundle, *Options) (Content, error) {
	panic("content package panic")
}

func TestPanicError(t *testing.T) {
	for _, test := range []struct {
		value    any
		expected string
	}{
		{"string panic", "plugin panicked in transform: string panic"},
		{errors.New("error panic"), "plugin panicked in transform: error panic"},
		{42, "plugin panicked in transform: 42"},
	} {
		if message := panicError("transform", test.value).Error(); message != test.expected {
			t.Fatalf("expected %q, got %q", test.expected, message)
		}
	}
}

func TestIncompatibleHostAPIIsRejected(t *testing.T) {
	previousFactory := pluginFactory
	defer func() { pluginFactory = previousFactory }()
	pluginFactory = func([]byte) (Plugin, error) {
		t.Fatal("plugin was constructed against an incompatible host")
		return nil, nil
	}

	// A Parcel older than this SDK: the table is missing fields the SDK would
	// otherwise read straight past the end of.
	truncated := hostAPI(-8, 0)
	defer freeHostAPI(truncated)
	assertIncompatible(t, truncated, "a truncated host API table")

	// A breaking change to an existing function. The table is exactly the same
	// size, so only the ABI version catches this.
	for _, delta := range []int{-1, 1} {
		mismatched := hostAPI(0, delta)
		defer freeHostAPI(mismatched)
		assertIncompatible(t, mismatched, "a mismatched ABI version")
	}

	assertIncompatible(t, nil, "no host API table")
}

// assertIncompatible checks that init rejects the table without touching it.
// The diagnostic pointer is real: writing one goes through the table being
// rejected, so a plugin that tried would crash rather than report.
func assertIncompatible(t *testing.T, api *_Ctype_struct_ParcelApi, what string) {
	t.Helper()
	var state unsafe.Pointer
	var diag _Ctype_Diagnostic

	status := parcel_plugin_init(api, nil, 0, &state, &diag)

	if status != incompatibleStatus() {
		t.Fatalf("expected PARCEL_INIT_INCOMPATIBLE for %s, got status %d", what, status)
	}
	if state != nil {
		t.Fatalf("state was written for %s", what)
	}
	if diagnosticWritten(&diag) {
		t.Fatalf("a diagnostic was written for %s; Parcel builds that message", what)
	}
}

func TestPluginPanicsDoNotCrossCBoundary(t *testing.T) {
	previousFactory := pluginFactory
	defer func() { pluginFactory = previousFactory }()

	pluginFactory = func([]byte) (Plugin, error) {
		panic("init panic")
	}
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	var state unsafe.Pointer
	if status := parcel_plugin_init(api, nil, 0, &state, nil); status == okStatus() {
		t.Fatal("panicking plugin factory reported success")
	}

	pluginFactory = func([]byte) (Plugin, error) {
		return &panickingPlugin{}, nil
	}
	state = nil
	if status := parcel_plugin_init(api, nil, 0, &state, nil); status != okStatus() {
		t.Fatalf("plugin initialization failed with status %d", status)
	}
	if state == nil {
		t.Fatal("plugin initialization produced no state")
	}
	defer parcel_plugin_deinit(state)

	parcel_plugin_transform(0, 0, state, nil)
	parcel_plugin_resolve(0, nil, 0, nil, 0, 0, nil, state, nil)
	parcel_plugin_name(0, 0, 0, nil, state, nil)
	parcel_plugin_optimize(0, 0, nil, 0, nil, 0, 0, nil, state, nil)
}

func TestCustomContentPanicsDoNotCrossCBoundary(t *testing.T) {
	rawContent, _ := registerContent(&panickingContent{})
	defer parcel_go_content_free(rawContent)

	parcel_go_content_read(rawContent, nil, nil)
	parcel_go_content_package(rawContent, 0, 0, 0, nil, nil)
}

func TestRecoverDiagnosticFormatsScope(t *testing.T) {
	var escaped any
	func() {
		defer func() { escaped = recover() }()
		func() {
			defer recoverDiagnostic("custom content read", nil)
			panic("boom")
		}()
	}()
	if escaped != nil {
		t.Fatalf("panic escaped recovery helper: %v", escaped)
	}
	if !strings.Contains(panicError("custom content read", "boom").Error(), "custom content read") {
		t.Fatal("panic diagnostic omitted callback scope")
	}
}
