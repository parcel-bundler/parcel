package parcel

import (
	"sync/atomic"
	"testing"
)

type testAssetContent struct {
	reads    atomic.Int32
	packages atomic.Int32
}

func (c *testAssetContent) Read() (Content, error) {
	c.reads.Add(1)
	return BytesContent(nil), nil
}

func (c *testAssetContent) Package(*BundleGraph, *Bundle, *Options) (Content, error) {
	c.packages.Add(1)
	return StringContent(""), nil
}

func TestContentVariants(t *testing.T) {
	bytes := BytesContent([]byte{0xff})
	if len(bytes) != 1 || bytes[0] != 0xff {
		t.Fatalf("unexpected bytes content: %#v", bytes)
	}

	text := StringContent("hello")
	if string(text) != "hello" {
		t.Fatalf("unexpected string content: %#v", text)
	}

	if err := writeContentBuffer(nil, StringContent("\xff")); err == nil {
		t.Fatal("expected invalid UTF-8 StringContent to be rejected")
	}
	if err := writeContentBuffer(nil, nil); err == nil {
		t.Fatal("expected nil Content to be rejected")
	}
}

func TestCustomContentHandleLifecycle(t *testing.T) {
	content := &testAssetContent{}
	raw, typeID := registerContent(content)

	got, registered, ok := contentForPointer(raw)
	if !ok || got != content || registered.typeID != typeID {
		t.Fatal("registered content was not recoverable")
	}

	// Empty results avoid calling the host-owned buffer functions while still
	// exercising the callbacks and their cgo.Handle lookup.
	parcel_go_content_read(raw, nil, nil)
	parcel_go_content_package(raw, 0, 0, 0, nil, nil)
	if content.reads.Load() != 1 || content.packages.Load() != 1 {
		t.Fatalf("callbacks not invoked: reads=%d packages=%d", content.reads.Load(), content.packages.Load())
	}

	parcel_go_content_free(raw)
	if _, _, ok := contentForPointer(raw); ok {
		t.Fatal("content remained registered after free")
	}
}
