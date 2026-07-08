'use strict';

const path = require('node:path');

const { normalizeConvertOptions } = require('./options');
const { AvifGainMapError, runFile } = require('./process');
const {
  SUPPORTED_PLATFORM_KEYS,
  TOOL_GAINMAP_CONVERT,
  TOOL_GAINMAP_PROBE,
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

function buildConvertArgs(input, output, options) {
  const args = [input, output];
  pushOption(args, '--qcolor', options.quality);
  pushOption(args, '--qgain-map', options.gainMapQuality);
  pushOption(args, '--speed', options.speed);
  pushOption(args, '--jobs', options.jobs);
  pushOption(args, '--depth', options.depth);
  pushOption(args, '--yuv', options.yuv);
  pushOption(args, '--cicp', options.cicp);
  pushOption(args, '--clli', options.clli);
  if (options.swapBase) {
    args.push('--swap-base');
  }
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
  const convertPath = assertToolAvailable(
    resolveTool(TOOL_GAINMAP_CONVERT, options),
    TOOL_GAINMAP_CONVERT
  );

  const convertArgs = buildConvertArgs(input, output, options);
  const convert = await runFile(convertPath, convertArgs, options);

  return {
    convert,
    input: path.resolve(input),
    output: path.resolve(output),
    resized: Boolean(options.size),
    strippedMetadata: Boolean(options.stripMetadata)
  };
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
