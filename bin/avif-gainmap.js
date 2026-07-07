#!/usr/bin/env node
'use strict';

const { convertJpegGainMap } = require('../src');
const { normalizeJobs } = require('../src/options');
const { version } = require('../package.json');

function printHelp() {
  process.stdout.write(`avif-gainmap ${version}

Usage:
  avif-gainmap convert <input.jpg> <output.avif> [options]

Options:
  -q, --quality <0-100>            AVIF color quality. Default: 80
      --gain-map-quality <0-100>   Gain map quality. Default: 60
      --width <px>                 Exact output width. Height is kept proportional if omitted.
      --height <px>                Exact output height. Width is kept proportional if omitted.
      --max-width <px>             Downscale to fit this width.
      --max-height <px>            Downscale to fit this height.
      --speed <0-10>               Encoder speed. 0 is slowest, 10 is fastest. Default: 6
      --jobs <n|all>               Worker threads.
      --swap-base                  Make the HDR image the AVIF base image.
      --cicp <P/T/M>               Override input CICP values.
      --clli <MaxCLL,MaxPALL>      Set alternate image light level information.
      --depth <8|10|12>            Output bit depth passed to libavif.
      --yuv <444|422|420|400>      Output YUV format passed to libavif.
      --keep-temp                  Keep intermediate AVIF when resizing.
      --verbose                    Stream native tool output.
  -h, --help                       Show this help.
      --version                    Show version.
`);
}

function readValue(args, index, inlineValue, flag) {
  if (inlineValue !== undefined) {
    return [inlineValue, index];
  }
  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value.`);
  }
  return [args[index + 1], index + 1];
}

function parseConvertArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1);

    switch (flag) {
      case '-q':
      case '--quality': {
        const result = readValue(args, i, inlineValue, flag);
        options.quality = result[0];
        i = result[1];
        break;
      }
      case '--gain-map-quality':
      case '--qgain-map': {
        const result = readValue(args, i, inlineValue, flag);
        options.gainMapQuality = result[0];
        i = result[1];
        break;
      }
      case '--width':
      case '--height':
      case '--max-width':
      case '--max-height':
      case '--speed':
      case '--depth':
      case '--yuv':
      case '--cicp':
      case '--clli': {
        const result = readValue(args, i, inlineValue, flag);
        const key = flag
          .replace(/^--/, '')
          .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        options[key] = result[0];
        i = result[1];
        break;
      }
      case '--jobs': {
        const result = readValue(args, i, inlineValue, flag);
        options.jobs = normalizeJobs(result[0]);
        i = result[1];
        break;
      }
      case '--swap-base':
        options.swapBase = true;
        break;
      case '--keep-temp':
        options.keepTemp = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      default:
        if (raw.startsWith('-')) {
          throw new Error(`Unknown option ${raw}.`);
        }
        positional.push(raw);
    }
  }

  if (positional.length !== 2) {
    throw new Error('convert requires <input.jpg> and <output.avif>.');
  }

  return { input: positional[0], options, output: positional[1] };
}

async function main(argv) {
  const command = argv[2];
  if (!command || command === '-h' || command === '--help') {
    printHelp();
    return;
  }
  if (command === '--version') {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (command !== 'convert') {
    throw new Error(`Unknown command ${command}.`);
  }

  const { input, output, options } = parseConvertArgs(argv.slice(3));
  await convertJpegGainMap(input, output, options);
}

main(process.argv).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error.stderr) {
    process.stderr.write(error.stderr);
  }
  process.exitCode = 1;
});
