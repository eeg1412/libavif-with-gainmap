'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  TOOL_GAINMAP_RESIZE,
  TOOL_GAINMAP_UTIL,
  executableName,
  getPlatformKey,
  packageRoot
} = require('../src/platform');

const LIBAVIF_VERSION = process.env.LIBAVIF_VERSION || 'v1.4.2';
const root = packageRoot();
const cacheDir = path.join(root, '.cache');
const sourceDir = process.env.LIBAVIF_SOURCE_DIR || path.join(cacheDir, `libavif-${LIBAVIF_VERSION}`);
const buildDir = process.env.LIBAVIF_BUILD_DIR || path.join(cacheDir, `build-${LIBAVIF_VERSION}`);
const installDir = process.env.LIBAVIF_INSTALL_DIR || path.join(cacheDir, `install-${LIBAVIF_VERSION}`);
const platformKey = process.env.TARGET_PLATFORM_KEY || getPlatformKey();
const vendorDir = path.join(root, 'vendor', platformKey);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    shell: false,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function splitExtraArgs(value) {
  if (!value) {
    return [];
  }
  return value.split(/\s+/).filter(Boolean);
}

function ensureSource() {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(path.join(sourceDir, 'CMakeLists.txt'))) {
    return;
  }
  run('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    LIBAVIF_VERSION,
    'https://github.com/AOMediaCodec/libavif.git',
    sourceDir
  ]);
}

function installResizeToolSource() {
  fs.copyFileSync(
    path.join(root, 'native', 'avifgainmapresize.c'),
    path.join(sourceDir, 'apps', 'avifgainmapresize.c')
  );
}

function patchCMake() {
  const cmakePath = path.join(sourceDir, 'CMakeLists.txt');
  let content = fs.readFileSync(cmakePath, 'utf8');
  if (!content.includes('avifgainmapresize')) {
    const linkNeedle = 'target_link_libraries(avifgainmaputil libargparse avif_apps avif avif_enable_warnings)';
    if (!content.includes(linkNeedle)) {
      throw new Error('Unable to patch libavif CMakeLists.txt: avifgainmaputil target not found.');
    }
    content = content.replace(
      linkNeedle,
      `${linkNeedle}

    add_executable(avifgainmapresize apps/avifgainmapresize.c)
    if(AVIF_LIB_USE_CXX)
        set_target_properties(avifgainmapresize PROPERTIES LINKER_LANGUAGE "CXX")
    endif()
    target_link_libraries(avifgainmapresize avif avif_enable_warnings)`
    );

  }

  content = content.replace(
    /TARGETS\s+avifenc\s+avifdec\s+avifgainmaputil(?!\s+avifgainmapresize)/,
    'TARGETS avifenc avifdec avifgainmaputil avifgainmapresize'
  );
  fs.writeFileSync(cmakePath, content);
}

function configureAndBuild() {
  const generator = process.env.CMAKE_GENERATOR || 'Ninja';
  const cmakeArgs = [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    '-G',
    generator,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DAVIF_BUILD_APPS=ON',
    '-DAVIF_BUILD_TESTS=OFF',
    '-DAVIF_CODEC_AOM=LOCAL',
    '-DAVIF_JPEG=LOCAL',
    '-DAVIF_LIBSHARPYUV=LOCAL',
    '-DAVIF_LIBXML2=LOCAL',
    '-DAVIF_LIBYUV=LOCAL',
    '-DAVIF_ZLIBPNG=LOCAL',
    '-DAVIF_ENABLE_WERROR=OFF',
    `-DCMAKE_INSTALL_PREFIX=${installDir}`,
    ...splitExtraArgs(process.env.LIBAVIF_CMAKE_ARGS)
  ];

  if (process.platform === 'win32') {
    cmakeArgs.push('-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded');
  }

  run('cmake', cmakeArgs);
  run('cmake', ['--build', buildDir, '--config', 'Release', '--parallel']);
  run('cmake', ['--install', buildDir, '--config', 'Release']);
}

function findBuiltBinary(fileName) {
  const candidates = [
    path.join(installDir, 'bin', fileName),
    path.join(buildDir, fileName),
    path.join(buildDir, 'Release', fileName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const stack = [buildDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
    }
  }
  return null;
}

function copyBinaries() {
  fs.mkdirSync(vendorDir, { recursive: true });
  for (const tool of [TOOL_GAINMAP_UTIL, TOOL_GAINMAP_RESIZE]) {
    const name = executableName(tool, platformKey);
    const from = findBuiltBinary(name);
    const to = path.join(vendorDir, name);
    if (!from) {
      throw new Error(`Expected built binary was not found: ${name}`);
    }
    fs.copyFileSync(from, to);
    if (!platformKey.startsWith('win32-')) {
      fs.chmodSync(to, 0o755);
    }
  }
}

ensureSource();
installResizeToolSource();
patchCMake();
configureAndBuild();
copyBinaries();
