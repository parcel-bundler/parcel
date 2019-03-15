GLOBAL_A='var self = Object.create(global)'
GLOBAL_B='var self = global'

REQUIRE_A='self.require("fs")'
REQUIRE_B='require("fs")'

sed -i '.bak' "s/$GLOBAL_A/$GLOBAL_B/; s/$REQUIRE_A/$REQUIRE_B/" $(node -p 'require.resolve("sass")')
