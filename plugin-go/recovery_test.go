package parcel

import (
	"errors"
	"strings"
	"testing"
)

type panickingPlugin struct {
	DefaultPlugin
}

func (*panickingPlugin) Transform(*Asset, *Options) error {
	panic("transform panic")
}

func (*panickingPlugin) Resolve(*Dependency, string, string, *Options, *ResolveResult) error {
	panic(errors.New("resolve panic"))
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

func TestPluginPanicsDoNotCrossCBoundary(t *testing.T) {
	previousFactory := pluginFactory
	defer func() { pluginFactory = previousFactory }()

	pluginFactory = func([]byte) (Plugin, error) {
		panic("init panic")
	}
	if state := parcel_plugin_init(nil, 0, nil); state != nil {
		t.Fatal("panicking plugin factory returned non-nil state")
	}

	pluginFactory = func([]byte) (Plugin, error) {
		return &panickingPlugin{}, nil
	}
	state := parcel_plugin_init(nil, 0, nil)
	if state == nil {
		t.Fatal("plugin initialization failed")
	}
	defer parcel_plugin_deinit(state)

	parcel_plugin_transform(0, 0, state, nil)
	parcel_plugin_resolve(0, nil, 0, nil, 0, 0, nil, state, nil)
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
