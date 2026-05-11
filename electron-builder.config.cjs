const fs = require('fs');
const os = require('os');
const path = require('path');

function findZip(root, filename, maxDepth = 4) {
  const matches = [];

  function walk(dir, depth) {
    if (depth < 0) {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        if (entry.name === filename) {
          matches.push(fullPath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath, depth - 1);
      }
    }
  }

  walk(root, maxDepth);

  if (!matches.length) {
    return null;
  }

  return matches
    .map((file) => {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        // Ignore files that disappear during the scan.
      }
      return { file, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].file;
}

function resolveElectronDist(prepareOptions) {
  const filename = `electron-v${prepareOptions.version}-${prepareOptions.platformName}-${prepareOptions.arch}.zip`;
  const override = process.env.ELECTRON_DIST_ZIP || process.env.ELECTRON_BUILDER_ELECTRON_ZIP;

  const candidates = [
    override,
    path.join(process.cwd(), '.cache', 'electron'),
    path.join(process.cwd(), '.electron-cache'),
    os.tmpdir(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const stat = fs.statSync(candidate);
    if (stat.isFile() && path.basename(candidate) === filename) {
      return path.resolve(candidate);
    }

    if (stat.isDirectory()) {
      const found = findZip(candidate, filename);
      if (found) {
        return path.resolve(found);
      }
    }
  }

  return undefined;
}

module.exports = {
  appId: 'com.unitywebrunner.app',
  productName: 'UnityWebRunner',
  icon: 'public/unitywebrunner-icon.png',
  electronDist: resolveElectronDist,
  directories: {
    output: 'release',
  },
  files: [
    'dist-electron/**/*',
    'public/**/*',
    'package.json',
  ],
  asar: true,
  linux: {
    icon: 'public/unitywebrunner-icon.png',
    target: ['AppImage', 'dir'],
  },
  win: {
    icon: 'public/unitywebrunner-icon.png',
    target: ['dir'],
  },
};
