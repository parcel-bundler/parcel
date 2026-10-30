//go:build parceltest

package parcel

import (
	"encoding/hex"
	"strings"
	"testing"
)

type namedContent struct{ testAssetContent }

type renamedContent struct{ testAssetContent }

func (*renamedContent) ContentTypeName() string { return "Renamed" }

// Every SDK derives content type IDs the same way. This is the ID the Rust SDK
// gives a type named TestContent in its own package (see the golden value in
// crates/parcel-plugin/src/lib.rs), so the derivations cannot drift apart. If
// it changes, every plugin's bundle IDs change with it.
func TestContentTypeIDDerivationMatchesTheOtherSDKs(t *testing.T) {
	id := contentTypeID("parcel-plugin", "TestContent")
	if got := hex.EncodeToString(id[:]); got != "d871006b60160e55afdcbb060b0db0d2" {
		t.Fatalf("content type ID derivation changed: %s", got)
	}
}

// Content types are namespaced by the plugin's module path, since every Go
// plugin's types live in package main, and two plugins with a main.AST would
// otherwise collide.
func TestContentTypeIDsAreNamespacedByModule(t *testing.T) {
	if namespace := contentNamespace(); namespace != "github.com/parcel-bundler/parcel/plugin-go" {
		t.Fatalf("unexpected namespace %q", namespace)
	}
	if contentTypeID("example.com/a", "main.AST") == contentTypeID("example.com/b", "main.AST") {
		t.Fatal("two plugins' main.AST share a content type ID")
	}
}

func TestContentTypeNames(t *testing.T) {
	for _, test := range []struct {
		content  AssetContent
		expected string
	}{
		// Through the pointer, so *T and T are the same content type.
		{&namedContent{}, "github.com/parcel-bundler/parcel/plugin-go.namedContent"},
		{&renamedContent{}, "Renamed"},
	} {
		name, err := contentTypeName(test.content)
		if err != nil || name != test.expected {
			t.Errorf("expected %q, got %q (%v)", test.expected, name, err)
		}
	}

	// A type with no name has nothing stable to derive an ID from.
	unnamed := &struct{ testAssetContent }{}
	if _, err := contentTypeName(unnamed); err == nil || !strings.Contains(err.Error(), "ContentTypeName") {
		t.Fatalf("expected an unnamed content type to be rejected, got %v", err)
	}
}
