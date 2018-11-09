# yarn-workspace

This package should test the followings:

1. `package-a` (JavaScript project)
   1.1. should install babel with `yarn add` (not `npm install`) - should detect `yarn.lock` file in the root
2. `package-b` (TypeScript project)
   2.1. should remove comments when compiled, since it is extending definition from the root
   2.2. should not require to install `typescript` as a devDependency
3. `package-main` (TypeScript project)
   3.1. should remove comments when compiled, since it falls back to the root
   3.2. should not require to install `typescript` as a devDependency
