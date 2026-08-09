package parcel_test

import (
	"bufio"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	parcel "github.com/parcel-bundler/parcel/plugin-go"
)

// parseHeaderDefines extracts integer constants from plugin.h.
// It handles both #define macros and C enum variant lines (PARCEL_FOO = value,).
func parseHeaderDefines(path string) (map[string]int, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	defineRe := regexp.MustCompile(`^#define\s+(\w+)\s+(.+)$`)
	enumRe := regexp.MustCompile(`^(PARCEL_\w+)\s*=\s*(.+?),?\s*$`)
	shiftRe := regexp.MustCompile(`^\(1\s*<<\s*(\d+)\)$`)

	parseValue := func(raw string) (int, bool) {
		raw = strings.TrimSpace(raw)
		if sm := shiftRe.FindStringSubmatch(raw); sm != nil {
			n, _ := strconv.Atoi(sm[1])
			return 1 << n, true
		} else if strings.HasPrefix(raw, "0x") || strings.HasPrefix(raw, "0X") {
			if n, err := strconv.ParseInt(raw[2:], 16, 64); err == nil {
				return int(n), true
			}
		} else if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return int(n), true
		}
		return 0, false
	}

	out := map[string]int{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if m := defineRe.FindStringSubmatch(line); m != nil {
			if v, ok := parseValue(m[2]); ok {
				out[m[1]] = v
			}
		} else if m := enumRe.FindStringSubmatch(line); m != nil {
			if v, ok := parseValue(m[2]); ok {
				out[m[1]] = v
			}
		}
	}
	return out, scanner.Err()
}

// TestConstantsMatchHeader verifies that every typed Go constant has the same
// numeric value as the corresponding #define in plugin.h.  A mismatch means
// build.rs regenerated the header with a new value but parcel.go was not
// updated to match.
func TestConstantsMatchHeader(t *testing.T) {
	defs, err := parseHeaderDefines("plugin.h")
	if err != nil {
		t.Fatalf("could not read plugin.h: %v", err)
	}

	check := func(goName, cName string, goVal int) {
		t.Helper()
		cVal, ok := defs[cName]
		if !ok {
			t.Errorf("%s: C constant %s not found in plugin.h", goName, cName)
			return
		}
		if goVal != cVal {
			t.Errorf("%s: Go=%d C(%s)=%d", goName, goVal, cName, cVal)
		}
	}

	pairs := []struct {
		goName, cName string
		goVal         int
	}{
		{"InvalidAssetIndex", "PARCEL_INVALID_ASSET_INDEX", int(parcel.InvalidAssetIndex)},
		// SpecifierType
		{"SpecifierTypeEsm", "PARCEL_SPECIFIER_ESM", int(parcel.SpecifierTypeEsm)},
		{"SpecifierTypeCommonjs", "PARCEL_SPECIFIER_COMMONJS", int(parcel.SpecifierTypeCommonjs)},
		{"SpecifierTypeUrl", "PARCEL_SPECIFIER_URL", int(parcel.SpecifierTypeUrl)},
		{"SpecifierTypeCustom", "PARCEL_SPECIFIER_CUSTOM", int(parcel.SpecifierTypeCustom)},
		// Priority
		{"PrioritySync", "PARCEL_PRIORITY_SYNC", int(parcel.PrioritySync)},
		{"PriorityParallel", "PARCEL_PRIORITY_PARALLEL", int(parcel.PriorityParallel)},
		{"PriorityLazy", "PARCEL_PRIORITY_LAZY", int(parcel.PriorityLazy)},
		// BundleBehavior
		{"BundleBehaviorNone", "PARCEL_BUNDLE_BEHAVIOR_NONE", int(parcel.BundleBehaviorNone)},
		{"BundleBehaviorInline", "PARCEL_BUNDLE_BEHAVIOR_INLINE", int(parcel.BundleBehaviorInline)},
		{"BundleBehaviorIsolated", "PARCEL_BUNDLE_BEHAVIOR_ISOLATED", int(parcel.BundleBehaviorIsolated)},
		// BundleGraphResolutionType
		{"BundleGraphResolutionInvalid", "PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID", int(parcel.BundleGraphResolutionInvalid)},
		{"BundleGraphResolutionNone", "PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE", int(parcel.BundleGraphResolutionNone)},
		{"BundleGraphResolutionDeferred", "PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED", int(parcel.BundleGraphResolutionDeferred)},
		{"BundleGraphResolutionExternal", "PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL", int(parcel.BundleGraphResolutionExternal)},
		{"BundleGraphResolutionExcluded", "PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED", int(parcel.BundleGraphResolutionExcluded)},
		{"BundleGraphResolutionAsset", "PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET", int(parcel.BundleGraphResolutionAsset)},
		{"BundleGraphResolutionBundle", "PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE", int(parcel.BundleGraphResolutionBundle)},
		// DependencyFlags
		{"DependencyFlagEntry", "PARCEL_DEP_ENTRY", int(parcel.DependencyFlagEntry)},
		{"DependencyFlagOptional", "PARCEL_DEP_OPTIONAL", int(parcel.DependencyFlagOptional)},
		{"DependencyFlagNeedsStableName", "PARCEL_DEP_NEEDS_STABLE_NAME", int(parcel.DependencyFlagNeedsStableName)},
		{"DependencyFlagIsWebworker", "PARCEL_DEP_IS_WEBWORKER", int(parcel.DependencyFlagIsWebworker)},
		{"DependencyFlagSideEffects", "PARCEL_DEP_SIDE_EFFECTS", int(parcel.DependencyFlagSideEffects)},
		{"DependencyFlagMacro", "PARCEL_DEP_MACRO", int(parcel.DependencyFlagMacro)},
		// ExportsConditions
		{"ExportsConditionImport", "PARCEL_EXPORTS_CONDITION_IMPORT", int(parcel.ExportsConditionImport)},
		{"ExportsConditionRequire", "PARCEL_EXPORTS_CONDITION_REQUIRE", int(parcel.ExportsConditionRequire)},
		{"ExportsConditionModule", "PARCEL_EXPORTS_CONDITION_MODULE", int(parcel.ExportsConditionModule)},
		{"ExportsConditionNode", "PARCEL_EXPORTS_CONDITION_NODE", int(parcel.ExportsConditionNode)},
		{"ExportsConditionBrowser", "PARCEL_EXPORTS_CONDITION_BROWSER", int(parcel.ExportsConditionBrowser)},
		{"ExportsConditionWorker", "PARCEL_EXPORTS_CONDITION_WORKER", int(parcel.ExportsConditionWorker)},
		{"ExportsConditionWorklet", "PARCEL_EXPORTS_CONDITION_WORKLET", int(parcel.ExportsConditionWorklet)},
		{"ExportsConditionElectron", "PARCEL_EXPORTS_CONDITION_ELECTRON", int(parcel.ExportsConditionElectron)},
		{"ExportsConditionDevelopment", "PARCEL_EXPORTS_CONDITION_DEVELOPMENT", int(parcel.ExportsConditionDevelopment)},
		{"ExportsConditionProduction", "PARCEL_EXPORTS_CONDITION_PRODUCTION", int(parcel.ExportsConditionProduction)},
		{"ExportsConditionTypes", "PARCEL_EXPORTS_CONDITION_TYPES", int(parcel.ExportsConditionTypes)},
		{"ExportsConditionDefault", "PARCEL_EXPORTS_CONDITION_DEFAULT", int(parcel.ExportsConditionDefault)},
		{"ExportsConditionStyle", "PARCEL_EXPORTS_CONDITION_STYLE", int(parcel.ExportsConditionStyle)},
		{"ExportsConditionSass", "PARCEL_EXPORTS_CONDITION_SASS", int(parcel.ExportsConditionSass)},
		{"ExportsConditionLess", "PARCEL_EXPORTS_CONDITION_LESS", int(parcel.ExportsConditionLess)},
		{"ExportsConditionStylus", "PARCEL_EXPORTS_CONDITION_STYLUS", int(parcel.ExportsConditionStylus)},
		{"ExportsConditionReactServer", "PARCEL_EXPORTS_CONDITION_REACT_SERVER", int(parcel.ExportsConditionReactServer)},
		{"ExportsConditionSource", "PARCEL_EXPORTS_CONDITION_SOURCE", int(parcel.ExportsConditionSource)},
		// AssetFlags
		{"AssetFlagIsSource", "PARCEL_ASSET_IS_SOURCE", int(parcel.AssetFlagIsSource)},
		{"AssetFlagSideEffects", "PARCEL_ASSET_SIDE_EFFECTS", int(parcel.AssetFlagSideEffects)},
		{"AssetFlagIsBundleSplittable", "PARCEL_ASSET_IS_BUNDLE_SPLITTABLE", int(parcel.AssetFlagIsBundleSplittable)},
		{"AssetFlagLargeBlob", "PARCEL_ASSET_LARGE_BLOB", int(parcel.AssetFlagLargeBlob)},
		{"AssetFlagHasCjsExports", "PARCEL_ASSET_HAS_CJS_EXPORTS", int(parcel.AssetFlagHasCjsExports)},
		{"AssetFlagStaticExports", "PARCEL_ASSET_STATIC_EXPORTS", int(parcel.AssetFlagStaticExports)},
		{"AssetFlagShouldWrap", "PARCEL_ASSET_SHOULD_WRAP", int(parcel.AssetFlagShouldWrap)},
		{"AssetFlagIsConstantModule", "PARCEL_ASSET_IS_CONSTANT_MODULE", int(parcel.AssetFlagIsConstantModule)},
		{"AssetFlagHasNodeReplacements", "PARCEL_ASSET_HAS_NODE_REPLACEMENTS", int(parcel.AssetFlagHasNodeReplacements)},
		{"AssetFlagHasSymbols", "PARCEL_ASSET_HAS_SYMBOLS", int(parcel.AssetFlagHasSymbols)},
		{"AssetFlagIsHtmlAttr", "PARCEL_ASSET_IS_HTML_ATTR", int(parcel.AssetFlagIsHtmlAttr)},
		{"AssetFlagIsHtmlTag", "PARCEL_ASSET_IS_HTML_TAG", int(parcel.AssetFlagIsHtmlTag)},
		{"AssetFlagIsEsm", "PARCEL_ASSET_IS_ESM", int(parcel.AssetFlagIsEsm)},
		// BundleFlags
		{"BundleFlagNeedsStableName", "PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME", int(parcel.BundleFlagNeedsStableName)},
		{"BundleFlagIsSplittable", "PARCEL_BUNDLE_FLAG_IS_SPLITTABLE", int(parcel.BundleFlagIsSplittable)},
		{"BundleFlagIsPlaceholder", "PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER", int(parcel.BundleFlagIsPlaceholder)},
		{"BundleFlagEntry", "PARCEL_BUNDLE_FLAG_ENTRY", int(parcel.BundleFlagEntry)},
		// Environment
		{"EnvironmentBrowser", "PARCEL_ENV_BROWSER", int(parcel.EnvironmentBrowser)},
		{"EnvironmentWebWorker", "PARCEL_ENV_WEB_WORKER", int(parcel.EnvironmentWebWorker)},
		{"EnvironmentServiceWorker", "PARCEL_ENV_SERVICE_WORKER", int(parcel.EnvironmentServiceWorker)},
		{"EnvironmentWorklet", "PARCEL_ENV_WORKLET", int(parcel.EnvironmentWorklet)},
		{"EnvironmentNode", "PARCEL_ENV_NODE", int(parcel.EnvironmentNode)},
		{"EnvironmentElectronMain", "PARCEL_ENV_ELECTRON_MAIN", int(parcel.EnvironmentElectronMain)},
		{"EnvironmentElectronRenderer", "PARCEL_ENV_ELECTRON_RENDERER", int(parcel.EnvironmentElectronRenderer)},
		{"EnvironmentReactClient", "PARCEL_ENV_REACT_CLIENT", int(parcel.EnvironmentReactClient)},
		{"EnvironmentReactServer", "PARCEL_ENV_REACT_SERVER", int(parcel.EnvironmentReactServer)},
		// OutputFormat
		{"OutputFormatGlobal", "PARCEL_OUTPUT_FORMAT_GLOBAL", int(parcel.OutputFormatGlobal)},
		{"OutputFormatCommonjs", "PARCEL_OUTPUT_FORMAT_COMMONJS", int(parcel.OutputFormatCommonjs)},
		{"OutputFormatEsmodule", "PARCEL_OUTPUT_FORMAT_ESMODULE", int(parcel.OutputFormatEsmodule)},
		// SourceType
		{"SourceTypeModule", "PARCEL_SOURCE_TYPE_MODULE", int(parcel.SourceTypeModule)},
		{"SourceTypeScript", "PARCEL_SOURCE_TYPE_SCRIPT", int(parcel.SourceTypeScript)},
		// EnvironmentFlags
		{"EnvFlagIsLibrary", "PARCEL_ENV_FLAG_IS_LIBRARY", int(parcel.EnvFlagIsLibrary)},
		{"EnvFlagShouldOptimize", "PARCEL_ENV_FLAG_SHOULD_OPTIMIZE", int(parcel.EnvFlagShouldOptimize)},
		{"EnvFlagShouldScopeHoist", "PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST", int(parcel.EnvFlagShouldScopeHoist)},
		{"EnvFlagModuleTypeExtension", "PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION", int(parcel.EnvFlagModuleTypeExtension)},
		// DiagnosticSeverity
		{"SeverityError", "PARCEL_SEVERITY_ERROR", int(parcel.SeverityError)},
		{"SeverityWarning", "PARCEL_SEVERITY_WARNING", int(parcel.SeverityWarning)},
		{"SeveritySourceError", "PARCEL_SEVERITY_SOURCE_ERROR", int(parcel.SeveritySourceError)},
		{"SeverityInfo", "PARCEL_SEVERITY_INFO", int(parcel.SeverityInfo)},
		// ReportEventType is deliberately absent: the entry point switches on
		// the C constants directly, so those values cannot drift.
		// LogLevel
		{"LogError", "PARCEL_LOG_ERROR", int(parcel.LogError)},
		{"LogWarn", "PARCEL_LOG_WARN", int(parcel.LogWarn)},
		{"LogInfo", "PARCEL_LOG_INFO", int(parcel.LogInfo)},
		{"LogVerbose", "PARCEL_LOG_VERBOSE", int(parcel.LogVerbose)},
	}
	for _, p := range pairs {
		check(p.goName, p.cName, p.goVal)
	}
}
