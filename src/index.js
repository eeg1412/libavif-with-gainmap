'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { normalizeConvertOptions } = require('./options');
const { AvifGainMapError, runFile } = require('./process');
const {
  SUPPORTED_PLATFORM_KEYS,
  TOOL_GAINMAP_PROBE,
  TOOL_GAINMAP_RESIZE,
  TOOL_GAINMAP_UTIL,
  assertToolAvailable,
  getPlatformKey,
  resolveTool
} = require('./platform');

function asPath(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty file path.`);
  }
  return value;
}

function pushOption(args, flag, value) {
  if (value !== undefined && value !== null) {
    args.push(flag, String(value));
  }
}

function buildConvertArgs(input, output, options, forResize) {
  const args = ['convert'];
  pushOption(args, '--qcolor', forResize ? options.intermediateQuality : options.quality);
  pushOption(
    args,
    '--qgain-map',
    forResize ? options.intermediateGainMapQuality : options.gainMapQuality
  );
  pushOption(args, '--speed', options.speed);
  pushOption(args, '--jobs', options.jobs);
  pushOption(args, '--depth', options.depth);
  pushOption(args, '--yuv', options.yuv);
  pushOption(args, '--cicp', options.cicp);
  pushOption(args, '--clli', options.clli);
  if (options.swapBase) {
    args.push('--swap-base');
  }
  args.push(input, output);
  return args;
}

function buildResizeArgs(input, output, options) {
  const args = [input, output];
  pushOption(args, '--qcolor', options.quality);
  pushOption(args, '--qgain-map', options.gainMapQuality);
  pushOption(args, '--speed', options.speed);
  pushOption(args, '--jobs', options.jobs);

  const size = options.size;
  if (size) {
    pushOption(args, '--width', size.width);
    pushOption(args, '--height', size.height);
    pushOption(args, '--max-width', size.maxWidth);
    pushOption(args, '--max-height', size.maxHeight);
  }
  if (options.stripMetadata) {
    args.push('--strip-metadata');
  }
  return args;
}

async function convertJpegGainMap(input, output, rawOptions = {}) {
  input = asPath('input', input);
  output = asPath('output', output);

  const options = normalizeConvertOptions(rawOptions);
  const utilPath = assertToolAvailable(
    resolveTool(TOOL_GAINMAP_UTIL, options),
    TOOL_GAINMAP_UTIL
  );
  const shouldPostProcess = Boolean(options.size || options.stripMetadata);
  const resizePath = shouldPostProcess
    ? assertToolAvailable(resolveTool(TOOL_GAINMAP_RESIZE, options), TOOL_GAINMAP_RESIZE)
    : null;

  let tempDir;
  let intermediate = output;
  try {
    if (resizePath) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avif-gainmap-'));
      intermediate = path.join(tempDir, 'converted.avif');
    }

    // Post-processing is a second AVIF encode, so the intermediate conversion defaults to lossless.
    const convertArgs = buildConvertArgs(input, intermediate, options, Boolean(resizePath));
    const convert = await runFile(utilPath, convertArgs, options);

    let resize = null;
    if (resizePath) {
      const resizeArgs = buildResizeArgs(intermediate, output, options);
      resize = await runFile(resizePath, resizeArgs, options);
    }

    return {
      convert,
      input: path.resolve(input),
      output: path.resolve(output),
      postprocessed: Boolean(resize),
      resize,
      resized: Boolean(options.size && resize),
      strippedMetadata: Boolean(options.stripMetadata && resize),
      tempDir: options.keepTemp ? tempDir : undefined
    };
  } finally {
    if (tempDir && !options.keepTemp) {
      await fs.rm(tempDir, { force: true, recursive: true });
    }
  }
}

async function probeJpegGainMap(input, rawOptions = {}) {
  input = asPath('input', input);

  const options = normalizeConvertOptions(rawOptions);
  const probePath = assertToolAvailable(
    resolveTool(TOOL_GAINMAP_PROBE, options),
    TOOL_GAINMAP_PROBE
  );
  const args = [];
  pushOption(args, '--jobs', options.jobs);
  args.push(input);

  const probe = await runFile(probePath, args, { ...options, verbose: false });
  let parsed;
  try {
    parsed = JSON.parse(probe.stdout);
  } catch (cause) {
    throw new AvifGainMapError(`Failed to parse ${TOOL_GAINMAP_PROBE} output as JSON.`, {
      ...probe,
      cause
    });
  }
  return {
    ...parsed,
    input: path.resolve(input)
  };
}

async function runAvifGainMapUtil(args, rawOptions = {}) {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array.');
  }
  const options = normalizeConvertOptions(rawOptions);
  const utilPath = assertToolAvailable(
    resolveTool(TOOL_GAINMAP_UTIL, options),
    TOOL_GAINMAP_UTIL
  );
  return runFile(utilPath, args.map(String), options);
}

module.exports = {
  AvifGainMapError,
  SUPPORTED_PLATFORM_KEYS,
  convert: convertJpegGainMap,
  convertJpegGainMap,
  getPlatformKey,
  probeJpegGainMap,
  runAvifGainMapUtil
};
