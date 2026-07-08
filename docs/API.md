# API

## `convertJpegGainMap(input, output, options)`

把带 gain map 的 JPEG 转成 AVIF gain map。

```js
const { convertJpegGainMap } = require('libavif-with-gainmap');

await convertJpegGainMap('input.jpg', 'output.avif', {
  quality: 80,
  gainMapQuality: 60,
  maxWidth: 1600,
  maxHeight: 1200
});
```

## Options

- `stripMetadata`: remove Exif/XMP privacy metadata such as camera model, GPS and capture time. Default: `false`.
- `quality`: 主图质量，`0..100`，默认 `80`。
- `gainMapQuality`: gain map 质量，`0..100`，默认 `60`。
- `width`: 输出宽度。单独设置时保持比例。
- `height`: 输出高度。单独设置时保持比例。
- `maxWidth`: 最大宽度，只缩小不放大。
- `maxHeight`: 最大高度，只缩小不放大。
- `speed`: libavif 编码速度，`0..10`，默认 `6`。
- `jobs`: 线程数，正整数或 `'all'`。
- `depth`: 输出 bit depth，`8`、`10`、`12`。
- `yuv`: 输出 YUV 格式，`444`、`422`、`420`、`400`，默认 `420`。`420` 兼容性最好；如果需要更高色度保真度，可以显式使用 `444`。
- `swapBase`: 传给 `avifgainmaputil --swap-base`。
- `cicp`: 传给 `avifgainmaputil --cicp`，格式 `P/T/M`。
- `clli`: 传给 `avifgainmaputil --clli`，格式 `MaxCLL,MaxPALL`。
- `binDir`: 自定义二进制目录。
- `toolPaths`: `{ avifgainmaputil, avifgainmapresize, avifgainmapprobe }` 自定义工具路径。
- `verbose`: 把原生工具输出转发到当前 stdout/stderr。

返回值包含原生工具执行结果：

```js
{
  input: '/abs/input.jpg',
  output: '/abs/output.avif',
  postprocessed: true,
  resized: true,
  strippedMetadata: true,
  convert: { command, args, stdout, stderr, exitCode },
  resize: { command, args, stdout, stderr, exitCode }
}
```

## `probeJpegGainMap(input, options)`

严格检测 JPEG 是否包含可由 libavif 解析的 gain map。这个 API 调用 `avifgainmapprobe`，只读取和解析 JPEG，不编码 AVIF。

```js
const { probeJpegGainMap } = require('libavif-with-gainmap');

const probe = await probeJpegGainMap('input.jpg', { jobs: 'all' });
```

返回值：

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

如果 JPEG 可以解码但没有 gain map，`hasGainMap` 为 `false`。如果输入不是 JPEG、文件打不开，或原生解析失败，会抛出 `AvifGainMapError`。
