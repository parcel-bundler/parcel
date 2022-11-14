const {existsSync, readFileSync} = require('fs');
const {join} = require('path');

const {platform, arch} = process;

let nativeBinding = null;
let localFileExisted = false;
let loadError = null;

function isMusl() {
  // For Node 10
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      return readFileSync('/usr/bin/ldd', 'utf8').includes('musl');
    } catch (e) {
      return true;
    }
  } else {
    const {glibcVersionRuntime} = process.report.getReport().header;
    return !glibcVersionRuntime;
  }
}

switch (platform) {
  case 'android':
    switch (arch) {
      case 'arm64':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.android-arm64.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.android-arm64.node');
          } else {
            nativeBinding = require('@parcel/db-android-arm64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.android-arm-eabi.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.android-arm-eabi.node');
          } else {
            nativeBinding = require('@parcel/db-android-arm-eabi');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Android ${arch}`);
    }
    break;
  case 'win32':
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.win32-x64-msvc.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.win32-x64-msvc.node');
          } else {
            nativeBinding = require('@parcel/db-win32-x64-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'ia32':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.win32-ia32-msvc.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.win32-ia32-msvc.node');
          } else {
            nativeBinding = require('@parcel/db-win32-ia32-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm64':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.win32-arm64-msvc.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.win32-arm64-msvc.node');
          } else {
            nativeBinding = require('@parcel/db-win32-arm64-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`);
    }
    break;
  case 'darwin':
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.darwin-x64.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.darwin-x64.node');
          } else {
            nativeBinding = require('@parcel/db-darwin-x64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm64':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.darwin-arm64.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.darwin-arm64.node');
          } else {
            nativeBinding = require('@parcel/db-darwin-arm64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on macOS: ${arch}`);
    }
    break;
  case 'freebsd':
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on FreeBSD: ${arch}`);
    }
    localFileExisted = existsSync(
      join(__dirname, 'parcel-db.freebsd-x64.node'),
    );
    try {
      if (localFileExisted) {
        nativeBinding = require('./parcel-db.freebsd-x64.node');
      } else {
        nativeBinding = require('@parcel/db-freebsd-x64');
      }
    } catch (e) {
      loadError = e;
    }
    break;
  case 'linux':
    switch (arch) {
      case 'x64':
        if (isMusl()) {
          localFileExisted = existsSync(
            join(__dirname, 'parcel-db.linux-x64-musl.node'),
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./parcel-db.linux-x64-musl.node');
            } else {
              nativeBinding = require('@parcel/db-linux-x64-musl');
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(
            join(__dirname, 'parcel-db.linux-x64-gnu.node'),
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./parcel-db.linux-x64-gnu.node');
            } else {
              nativeBinding = require('@parcel/db-linux-x64-gnu');
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      case 'arm64':
        if (isMusl()) {
          localFileExisted = existsSync(
            join(__dirname, 'parcel-db.linux-arm64-musl.node'),
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./parcel-db.linux-arm64-musl.node');
            } else {
              nativeBinding = require('@parcel/db-linux-arm64-musl');
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(
            join(__dirname, 'parcel-db.linux-arm64-gnu.node'),
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./parcel-db.linux-arm64-gnu.node');
            } else {
              nativeBinding = require('@parcel/db-linux-arm64-gnu');
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      case 'arm':
        localFileExisted = existsSync(
          join(__dirname, 'parcel-db.linux-arm-gnueabihf.node'),
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./parcel-db.linux-arm-gnueabihf.node');
          } else {
            nativeBinding = require('@parcel/db-linux-arm-gnueabihf');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`);
    }
    break;
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`);
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError;
  }
  throw new Error(`Failed to load native binding`);
}

const {
  fileId,
  fileName,
  createEnvironment,
  environmentIsLibrary,
  environmentShouldOptimize,
  environmentShouldScopeHoist,
  environmentContext,
  environmentOutputFormat,
  environmentSourceType,
  createDependency,
  dependencySpecifier,
  dependencyEnv,
  dependencyResolveFrom,
  dependencySpecifierType,
  dependencyPriority,
  dependencyBundleBehavior,
  dependencyIsEntry,
  dependencyNeedsStableName,
  dependencyIsOptional,
  createAsset,
  assetEnv,
  assetFileId,
  assetBundleBehavior,
  assetIsBundleSplittable,
  assetSideEffects,
  assetIsSource,
  assetContentKey,
} = nativeBinding;

module.exports.fileId = fileId;
module.exports.fileName = fileName;
module.exports.createEnvironment = createEnvironment;
module.exports.environmentIsLibrary = environmentIsLibrary;
module.exports.environmentShouldOptimize = environmentShouldOptimize;
module.exports.environmentShouldScopeHoist = environmentShouldScopeHoist;
module.exports.environmentContext = environmentContext;
module.exports.environmentOutputFormat = environmentOutputFormat;
module.exports.environmentSourceType = environmentSourceType;
module.exports.createDependency = createDependency;
module.exports.dependencySpecifier = dependencySpecifier;
module.exports.dependencyEnv = dependencyEnv;
module.exports.dependencyResolveFrom = dependencyResolveFrom;
module.exports.dependencySpecifierType = dependencySpecifierType;
module.exports.dependencyPriority = dependencyPriority;
module.exports.dependencyBundleBehavior = dependencyBundleBehavior;
module.exports.dependencyIsEntry = dependencyIsEntry;
module.exports.dependencyNeedsStableName = dependencyNeedsStableName;
module.exports.dependencyIsOptional = dependencyIsOptional;
module.exports.createAsset = createAsset;
module.exports.assetEnv = assetEnv;
module.exports.assetFileId = assetFileId;
module.exports.assetBundleBehavior = assetBundleBehavior;
module.exports.assetIsBundleSplittable = assetIsBundleSplittable;
module.exports.assetSideEffects = assetSideEffects;
module.exports.assetIsSource = assetIsSource;
module.exports.assetContentKey = assetContentKey;
