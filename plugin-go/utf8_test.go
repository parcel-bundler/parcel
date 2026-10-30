package parcel

import "testing"

type namingPlugin struct {
	DefaultPlugin
	name string
}

func (p *namingPlugin) Name(*BundleGraph, *Bundle, *Options) (string, error) {
	return p.name, nil
}

// Parcel trusts bytes passed as UTF-8 without checking them, and a Go string
// can hold anything, so the SDK only passes strings as UTF-8 once it has
// checked them.
func TestOnlyValidUTF8IsPassedAsUTF8(t *testing.T) {
	withUTF8Host(func(lastCall func() string) {
		asset := assetWithHandle(1)
		for _, test := range []struct {
			what     string
			call     func()
			expected string
		}{
			{"SetContent with text", func() { asset.SetContent("héllo") }, "asset_set_content_utf8"},
			{"SetContent with invalid UTF-8", func() { asset.SetContent("h\xffllo") }, "asset_set_content"},
			{"SetContent with nothing", func() { asset.SetContent("") }, "asset_set_content_utf8"},
			{"SetContentWithMap with text", func() { asset.SetContentWithMap("héllo", "{}") }, "asset_set_content_utf8_with_map"},
			{"SetContentWithMap with invalid UTF-8", func() { asset.SetContentWithMap("h\xffllo", "{}") }, "asset_set_content_with_map"},
			{"a name", func() { callName(t, "héllo.js") }, "buffer_write_utf8"},
			{"a name with invalid UTF-8", func() { callName(t, "h\xffllo.js") }, "buffer_write"},
		} {
			test.call()
			if call := lastCall(); call != test.expected {
				t.Errorf("%s: expected %s, got %q", test.what, test.expected, call)
			}
		}
	})
}

// callName runs the name entry point with a plugin that names the bundle name.
func callName(t *testing.T, name string) {
	t.Helper()
	state, free := pluginState(&namingPlugin{name: name})
	defer free()
	var result _Ctype_Buffer
	parcel_plugin_name(0, 0, 0, &result, state, nil)
}
