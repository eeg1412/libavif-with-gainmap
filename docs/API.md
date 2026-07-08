# API

## `convertJpegGainMap(input, output, options)`

Convert a JPEG gain map image to an AVIF gain map image.

```js
const { convertJpegGainMap } = require('libavif-with-gainmap');

await convertJpegGainMap('input.jpg', 'output.avif', {
  quality: 80,
  gainMapQuality: 60,
  maxWidth: 1600,
  maxHeight: 1200,
  stripMetadata: true
});
```

Conversion uses the package native helper `avifgainmapconvert`, which reads the
JPEG gain map, optionally resizes the base image and gain map image, optionally
removes Exif/XMP privacy metadata, and writes the final AVIF in one encode pass.
There is no two-stage full-size AVIF fallback.

## Options

- `quality`: AVIF base image quality, `0..100`, default `80`.
- `gainMapQuality`: gain map quality, `0..100`, default `60`.
- `width`: output width. If `height` is omitted, height is computed proportionally.
- `height`: output height. If `width` is omitted, width is computed proportionally.
- `maxWidth`: downscale to fit this width. Does not upscale.
- `maxHeight`: downscale to fit this height. Does not upscale.
- `speed`: libavif encoder speed, `0..10`, default `6`.
- `jobs`: worker threads, a positive integer or `'all'`.
- `depth`: output bit depth, `8`, `10` or `12`.
- `yuv`: output YUV format, `auto`, `444`, `422`, `420` or `400`, default `420`.
- `stripMetadata`: remove Exif/XMP privacy metadata such as camera model, GPS and capture time. Default: `false`.
- `swapBase`: make the HDR image the AVIF base image.
- `cicp`: override input CICP values, format `P/T/M`.
- `clli`: set alternate image light level information, format `MaxCLL,MaxPALL`.
- `binDir`: custom directory containing native binaries.
- `toolPaths`: custom tool paths, e.g. `{ avifgainmapconvert, avifgainmaputil, avifgainmapprobe }`.
- `verbose`: stream native tool stdout/stderr.

Return value:

```js
{
  input: '/abs/input.jpg',
  output: '/abs/output.avif',
  resized: true,
  strippedMetadata: true,
  convert: { command, args, stdout, stderr, exitCode }
}
```

## `probeJpegGainMap(input, options)`

Strictly detect whether a JPEG contains a gain map that libavif can parse. This
API calls `avifgainmapprobe`; it only reads and parses the JPEG and does not
encode AVIF.

```js
const { probeJpegGainMap } = require('libavif-with-gainmap');

const probe = await probeJpegGainMap('input.jpg', { jobs: 'all' });
```

Return value:

```js
{
  hasGainMap: true,
  input: '/abs/input.jpg',
  width: 4000,
  height: 3000,
  gainMap: {
    width: 1000,
    height: 750,
    baseHeadroom: 0,
    alternateHeadroom: 2.3
  }
}
```

If the JPEG can be decoded but has no gain map, `hasGainMap` is `false`. If the
input is not a JPEG, cannot be opened, or native parsing fails, the API throws
`AvifGainMapError`.
