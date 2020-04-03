####### @nodelib/fs.scandir

echo '"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IS_SUPPORT_READDIR_WITH_FILE_TYPES = true;' \
    > $(node -p 'require.resolve("@nodelib/fs.scandir/out/constants.js")')

####### (dart-)sass

# SASS_GLOBAL_A='var self = Object.create(global)'
# SASS_GLOBAL_B='var self = global'

# SASS_REQUIRE_A='self.require("fs")'
# SASS_REQUIRE_B='require("fs")'

# sed -i '.bak' "s/$SASS_GLOBAL_A/$SASS_GLOBAL_B/; s/$SASS_REQUIRE_A/$SASS_REQUIRE_B/" $(node -p 'require.resolve("sass")')


####### htmlnano

# HTMLNANO_REQUIRE_A='function htmlnano() {'
# HTMLNANO_REQUIRE_B="require('./presets/ampSafe'), require('./presets/hard'), require('./presets/max'), require('./presets/safe'), require('./modules/collapseAttributeWhitespace'), require('./modules/collapseBooleanAttributes'), require('./modules/collapseWhitespace'), require('./modules/custom'), require('./modules/deduplicateAttributeValues'), require('./modules/mergeScripts'), require('./modules/mergeStyles'), require('./modules/minifyJson'), require('./modules/minifySvg'), require('./modules/removeComments'), require('./modules/removeEmptyAttributes'), require('./modules/removeRedundantAttributes');"

# # removed to not bundle htmlnano>cssnano>jsdom:
# # , require('./modules/removeUnusedCss')

# sed -i '.bak' "s#$HTMLNANO_REQUIRE_A#$HTMLNANO_REQUIRE_B$HTMLNANO_REQUIRE_A#" $(node -p 'require.resolve("htmlnano/lib/htmlnano.js")')

