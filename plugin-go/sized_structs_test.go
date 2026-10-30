package parcel

import (
	"errors"
	"strings"
	"testing"
	"unsafe"
)

func TestAddDependencySetsSizeAndReportsRejection(t *testing.T) {
	withSizedStructHost(func(host sizedHost) {
		// Built at runtime so it lives on the Go heap, where cgo would panic on
		// an unpinned pointer inside the struct passed to C.
		specifier := strings.Repeat("./dep", 2) + ".js"

		if err := assetWithHandle(1).AddDependency(DependencySpec{Specifier: specifier}); err != nil {
			t.Fatalf("accepted dependency returned %v", err)
		}
		if host.dependencySize() != dependencyOptionsSize {
			t.Fatalf("expected DependencyOptions.size %d, got %d", dependencyOptionsSize, host.dependencySize())
		}
		if host.specifier() != specifier {
			t.Fatalf("expected specifier %q, got %q", specifier, host.specifier())
		}

		err := assetWithHandle(0).AddDependency(DependencySpec{Specifier: specifier})
		if err == nil || !strings.Contains(err.Error(), `"./dep./dep.js"`) {
			t.Fatalf("expected a rejection naming the specifier, got %v", err)
		}
	})
}

func TestResolveSetsSizesAndRejectsUnknownKinds(t *testing.T) {
	withSizedStructHost(func(host sizedHost) {
		for _, test := range []struct {
			kind  uint64
			ok    bool
			check func(ResolveResult) bool
		}{
			{0, true, func(r ResolveResult) bool {
				_, file := r.FilePath()
				return !file && !r.IsExternal() && !r.IsExcluded()
			}},
			{1, true, func(r ResolveResult) bool { path, file := r.FilePath(); return file && path == "/a.js" }},
			{2, true, ResolveResult.IsExternal},
			{3, true, ResolveResult.IsExcluded},
			// A kind of resolution a newer Parcel added.
			{200, false, nil},
		} {
			result, ok := assetWithHandle(test.kind).Resolve(DependencySpec{Specifier: "./a"}, "")
			if ok != test.ok {
				t.Fatalf("resolution type %d: expected ok=%v, got %v", test.kind, test.ok, ok)
			}
			if test.check != nil && !test.check(result) {
				t.Fatalf("resolution type %d: unexpected result %+v", test.kind, result)
			}
			if host.resolveResultSize() != resolveResultSize || host.dependencySize() != dependencyOptionsSize {
				t.Fatalf("expected sizes %d/%d, got %d/%d", resolveResultSize, dependencyOptionsSize, host.resolveResultSize(), host.dependencySize())
			}
		}
	})
}

func TestDependencyResolutionMapsUnknownTypesToInvalid(t *testing.T) {
	withSizedStructHost(func(host sizedHost) {
		graph := &BundleGraph{}
		for ty := BundleGraphResolutionNone; ty <= BundleGraphResolutionInternalized; ty++ {
			resolution := graph.DependencyResolution(AssetIndex(ty), 0)
			if resolution.Type != ty || resolution.Asset != 5 || resolution.Bundle != 6 {
				t.Fatalf("type %d: unexpected resolution %+v", ty, resolution)
			}
		}
		if host.resolutionSize() != resolutionSize {
			t.Fatalf("expected BundleGraphDependencyResolution.size %d, got %d", resolutionSize, host.resolutionSize())
		}

		for _, ty := range []AssetIndex{0, 200} {
			resolution := graph.DependencyResolution(ty, 0)
			if resolution.Type != BundleGraphResolutionInvalid || resolution.Asset != InvalidAssetIndex {
				t.Fatalf("type %d: expected an invalid resolution, got %+v", ty, resolution)
			}
		}
	})
}

func TestLogDiagnosticSetsSize(t *testing.T) {
	withSizedStructHost(func(host sizedHost) {
		(&Options{}).LogDiagnostic(&Diagnostic{Message: "careful", Hint: "a hint"})
		if host.diagnosticSize() != diagnosticSize {
			t.Fatalf("expected Diagnostic.size %d, got %d", diagnosticSize, host.diagnosticSize())
		}
	})
}

func TestWriteDiagnosticLeavesParcelsSize(t *testing.T) {
	withSizedStructHost(func(sizedHost) {
		diag, free := sizedDiagnostic(diagnosticSize)
		defer free()
		writeDiagnostic(diag, errors.New("boom"))
		if !diagnosticWritten(diag) {
			t.Fatal("diagnostic was not written")
		}
		if diagnosticSizeField(diag) != diagnosticSize {
			t.Fatalf("Diagnostic.size was overwritten with %d", diagnosticSizeField(diag))
		}
	})
}

func TestWriteDiagnosticWritesTheRangeAndLinks(t *testing.T) {
	withSizedStructHost(func(sizedHost) {
		diag, free := sizedDiagnostic(diagnosticSize)
		defer free()
		writeDiagnostic(diag, &Diagnostic{
			Message:          "unexpected token",
			FilePath:         "/project/a.js",
			Line:             1,
			Column:           9,
			EndLine:          1,
			EndColumn:        12,
			HighlightMessage: "expected an expression",
			DocumentationURL: "https://parceljs.org/errors/example",
		})
		endLine, endColumn, highlight, docs := rangeAndLinks(diag)
		if endLine != 1 || endColumn != 12 || highlight != "expected an expression" || docs != "https://parceljs.org/errors/example" {
			t.Fatalf("not written: %d:%d %q %q", endLine, endColumn, highlight, docs)
		}
	})
}

type recordingReporter struct {
	DefaultPlugin
	events []ReportEvent
}

func (r *recordingReporter) Report(event ReportEvent, _ *Options) error {
	r.events = append(r.events, event)
	return nil
}

func TestReportSkipsUndersizedAndUnknownEvents(t *testing.T) {
	previousFactory := pluginFactory
	defer func() { pluginFactory = previousFactory }()
	reporter := &recordingReporter{}
	pluginFactory = func([]byte) (Plugin, error) { return reporter, nil }

	withSizedStructHost(func(sizedHost) {
		var state unsafe.Pointer
		if status := parcel_plugin_init(parcelAPI(), nil, 0, &state, nil); status != okStatus() {
			t.Fatalf("plugin initialization failed with status %d", status)
		}
		defer parcel_plugin_deinit(state)

		for _, test := range []struct {
			size      uintptr
			eventType uint8
			reported  bool
		}{
			{reportEventSize, eventBuildStart, true},
			{reportEventMinSize, eventLog, true},
			// An event a newer Parcel added.
			{reportEventSize, 200, false},
			// Too small to be any version of the struct.
			{reportEventMinSize - 1, eventBuildStart, false},
			{0, eventBuildStart, false},
		} {
			reporter.events = nil
			event, free := newReportEvent(test.size, test.eventType)
			parcel_plugin_report(event, 0, state, nil)
			free()
			if reported := len(reporter.events) == 1; reported != test.reported {
				t.Fatalf("event type %d with size %d: expected reported=%v, got %v", test.eventType, test.size, test.reported, reported)
			}
		}
	})
}
