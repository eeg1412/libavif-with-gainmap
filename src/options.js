'use strict';

const os = require('node:os');

const DEFAULT_QUALITY = 80;
const DEFAULT_GAIN_MAP_QUALITY = 60;
const DEFAULT_SPEED = 6;
const DEFAULT_YUV = '420';

function toInteger(name, value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  throw new TypeError(`${name} must be an integer.`);
}

function integerInRange(name, value, min, max) {
  const number = toInteger(name, value);
  if (number < min || number > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

function optionalRange(name, value, min, max, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return integerInRange(name, value, min, max);
}

function positiveInteger(name, value) {
  const number = toInteger(name, value);
  if (number < 1) {
    throw new RangeError(`${name} must be greater than 0.`);
  }
  return number;
}

function optionalChoice(name, value, choices) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value);
  if (!choices.includes(normalized)) {
    throw new RangeError(`${name} must be one of: ${choices.join(', ')}.`);
  }
  return normalized;
}

function normalizeJobs(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'all') {
    return typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : Math.max(1, os.cpus().length);
  }
  return positiveInteger('jobs', value);
}

function normalizeSize(options) {
  const width = options.width === undefined ? undefined : positiveInteger('width', options.width);
  const height = options.height === undefined ? undefined : positiveInteger('height', options.height);
  const maxWidth =
    options.maxWidth === undefined ? undefined : positiveInteger('maxWidth', options.maxWidth);
  const maxHeight =
    options.maxHeight === undefined ? undefined : positiveInteger('maxHeight', options.maxHeight);

  if ((width || height) && (maxWidth || maxHeight)) {
    throw new Error('Use width/height or maxWidth/maxHeight, not both.');
  }
  if (!width && !height && !maxWidth && !maxHeight) {
    return null;
  }

  return { width, height, maxWidth, maxHeight };
}

function normalizeConvertOptions(options = {}) {
  const quality = optionalRange('quality', options.quality ?? options.qcolor, 0, 100, DEFAULT_QUALITY);
  const gainMapQuality = optionalRange(
    'gainMapQuality',
    options.gainMapQuality ?? options.qgainMap,
    0,
    100,
    DEFAULT_GAIN_MAP_QUALITY
  );

  return {
    binDir: options.binDir,
    cicp: options.cicp,
    clli: options.clli,
    cwd: options.cwd,
    depth:
      options.depth === undefined
        ? undefined
        : Number(optionalChoice('depth', options.depth, ['8', '10', '12'])),
    env: options.env,
    gainMapQuality,
    intermediateGainMapQuality: optionalRange(
      'intermediateGainMapQuality',
      options.intermediateGainMapQuality,
      0,
      100,
      100
    ),
    intermediateQuality: optionalRange(
      'intermediateQuality',
      options.intermediateQuality,
      0,
      100,
      100
    ),
    jobs: normalizeJobs(options.jobs),
    keepTemp: Boolean(options.keepTemp),
    platformKey: options.platformKey,
    quality,
    signal: options.signal,
    size: normalizeSize(options),
    speed: optionalRange('speed', options.speed, 0, 10, DEFAULT_SPEED),
    stripMetadata: Boolean(options.stripMetadata || options.stripPrivacy),
    swapBase: Boolean(options.swapBase),
    toolPaths: options.toolPaths,
    verbose: Boolean(options.verbose),
    yuv: optionalChoice('yuv', options.yuv ?? DEFAULT_YUV, ['auto', '444', '422', '420', '400'])
  };
}

module.exports = {
  DEFAULT_GAIN_MAP_QUALITY,
  DEFAULT_QUALITY,
  DEFAULT_SPEED,
  DEFAULT_YUV,
  normalizeConvertOptions,
  normalizeJobs,
  normalizeSize
};
