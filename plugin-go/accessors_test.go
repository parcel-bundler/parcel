//go:build parceltest

package parcel

import (
	"errors"
	"testing"
)

func TestDependencyImportType(t *testing.T) {
	withAccessorHost(func() {
		for _, importType := range []ImportType{ImportTypeJavaScript, ImportTypeStyleSheet, ImportTypeURL, ImportTypeText, ImportTypeBytes} {
			if got := dependencyWithHandle(uint64(importType)).ImportType(); got != importType {
				t.Errorf("expected import type %d, got %d", importType, got)
			}
		}
	})
}

func TestTransformerAssetDependencies(t *testing.T) {
	withAccessorHost(func() {
		dependencies := assetWithHandle(3).Dependencies()
		if len(dependencies) != 3 {
			t.Fatalf("expected 3 dependencies, got %d", len(dependencies))
		}
		for index, dependency := range dependencies {
			if got := rawDependency(dependency); got != uint64(100+index) {
				t.Errorf("dependency %d: expected handle %d, got %d", index, 100+index, got)
			}
		}
		if _, ok := assetWithHandle(3).Dependency(3); ok {
			t.Error("expected no dependency past the end")
		}
	})
}

func TestOptionsModeHMRAndLogLevel(t *testing.T) {
	withAccessorHost(func() {
		options := optionsWithHandle(uint64(LogVerbose))
		if got := options.Mode(); got != "staging" {
			t.Errorf("expected the custom mode, got %q", got)
		}
		if !options.HMR() || optionsWithHandle(uint64(LogWarn)).HMR() {
			t.Error("expected HMR only for the verbose options")
		}
		if got := optionsWithHandle(uint64(LogWarn)).LogLevel(); got != LogWarn {
			t.Errorf("expected LogWarn, got %v", got)
		}
	})
}

func TestAssetRefSourceMap(t *testing.T) {
	withSourceMapHost(func(mapped, unmapped *Asset) {
		if got := assetRefWithHandle(uint64(mapped.ptr)).SourceMap(); got != testSourceMap {
			t.Fatalf("expected %q, got %q", testSourceMap, got)
		}
		if got := assetRefWithHandle(uint64(unmapped.ptr)).SourceMap(); got != "" {
			t.Fatalf("expected no source map, got %q", got)
		}
	})
}

func TestResolveFailureCarriesParcelDiagnostics(t *testing.T) {
	withSizedStructHost(func(host sizedHost) {
		_, err := assetWithHandle(failedAsset).Resolve(DependencyOptions{Specifier: "./a"}, "")
		var diagnostic *Diagnostic
		if !errors.As(err, &diagnostic) {
			t.Fatalf("expected a *Diagnostic, got %v", err)
		}
		if diagnostic.Message != resolveFailure {
			t.Errorf("expected %q, got %q", resolveFailure, diagnostic.Message)
		}
		if diagnostic.parcelDiagnostics == 0 {
			t.Error("expected the error to stand for Parcel's diagnostics, to report them unchanged")
		}
	})
}
