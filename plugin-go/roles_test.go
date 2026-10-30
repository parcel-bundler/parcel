//go:build parceltest

package parcel

import (
	"errors"
	"strings"
	"testing"
	"unsafe"
)

type onlyTransformer struct{}

func (onlyTransformer) Transform(*Asset, *Options) error { return nil }

// A plugin used in a role it does not implement says so, rather than Parcel
// calling a method it lacks.
func TestPluginsAreCalledOnlyInRolesTheyImplement(t *testing.T) {
	withSizedStructHost(func(sizedHost) {
		state, free := pluginState(onlyTransformer{})
		defer free()
		diag, freeDiag := sizedDiagnostic(diagnosticSize)
		defer freeDiag()

		parcel_plugin_name(0, 0, 0, nil, state, diag)
		if message := diagnosticMessage(diag); !strings.Contains(message, "plugin does not implement Name") {
			t.Fatalf("unexpected diagnostic %q", message)
		}
	})
}

// A factory must return something Parcel can call.
func TestFactoriesMustReturnAPlugin(t *testing.T) {
	previousFactory := pluginFactory
	defer func() { pluginFactory = previousFactory }()

	withSizedStructHost(func(sizedHost) {
		for _, test := range []struct {
			plugin   any
			expected string
		}{
			{nil, "implements none of"},
			{struct{}{}, "returned struct {}, which implements none of"},
		} {
			pluginFactory = func([]byte) (any, error) { return test.plugin, nil }
			diag, free := sizedDiagnostic(diagnosticSize)
			var state unsafe.Pointer
			status := parcel_plugin_init(parcelAPI(), nil, 0, &state, diag)
			if status == okStatus() || state != nil {
				t.Fatalf("%v: expected init to fail", test.plugin)
			}
			if message := diagnosticMessage(diag); !strings.Contains(message, test.expected) {
				t.Fatalf("%v: unexpected diagnostic %q", test.plugin, message)
			}
			free()
		}
	})
}

// Parcel reads a missing message as no diagnostic, so an error without one
// must still fail the call.
func TestErrorsWithoutAMessageStillFail(t *testing.T) {
	withSizedStructHost(func(sizedHost) {
		diag, free := sizedDiagnostic(diagnosticSize)
		defer free()
		writeDiagnostic(diag, errors.New(""))
		if message := diagnosticMessage(diag); message != "unknown error" {
			t.Fatalf("unexpected message %q", message)
		}
	})
}
