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

- `quality`: 主图质量，`0..100`，默认 `80`。
- `gainMapQuality`: gain map 质量，`0..100`，默认 `60`。
- `width`: 输出宽度。单独设置时保持比例。
- `height`: 输出高度。单独设置时保持比例。
- `maxWidth`: 最大宽度，只缩小不放大。
- `maxHeight`: 最大高度，只缩小不放大。
- `speed`: libavif 编码速度，`0..10`，默认 `6`。
- `jobs`: 线程数，正整数或 `'all'`。
- `depth`: 输出 bit depth，`8`、`10`、`12`。
- `yuv`: 输出 YUV 格式，`444`、`422`、`420`、`400`。
- `swapBase`: 传给 `avifgainmaputil --swap-base`。
- `cicp`: 传给 `avifgainmaputil --cicp`，格式 `P/T/M`。
- `clli`: 传给 `avifgainmaputil --clli`，格式 `MaxCLL,MaxPALL`。
- `binDir`: 自定义二进制目录。
- `toolPaths`: `{ avifgainmaputil, avifgainmapresize }` 自定义工具路径。
- `verbose`: 把原生工具输出转发到当前 stdout/stderr。

返回值包含原生工具执行结果：

```js
{
  input: '/abs/input.jpg',
  output: '/abs/output.avif',
  resized: true,
  convert: { command, args, stdout, stderr, exitCode },
  resize: { command, args, stdout, stderr, exitCode }
}
```
