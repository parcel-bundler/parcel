package parcel

import "testing"

func TestSourceMapReturnsTheHostMap(t *testing.T) {
	withSourceMapHost(func(mapped, unmapped *Asset) {
		if got := mapped.SourceMap(); got != testSourceMap {
			t.Fatalf("expected %q, got %q", testSourceMap, got)
		}
		if got := unmapped.SourceMap(); got != "" {
			t.Fatalf("expected no source map, got %q", got)
		}
	})
}
