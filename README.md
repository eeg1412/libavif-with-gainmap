# libavif-with-gainmap

一个准备发布到 npm 的 Node.js 包，用 libavif 把带 gain map 的 JPEG 转成带 gain map 的 AVIF，并支持设置质量和输出尺寸。

## 特性

- 使用 libavif 的 `avifgainmaputil convert` 做 JPEG gain map -> AVIF gain map。
- 使用 `avifgainmapprobe` 严格检测 JPEG 是否包含可由 libavif 解析的 gain map，检测过程不编码 AVIF。
- 支持 `quality`、`gainMapQuality`、`speed`、`jobs`、`depth`、`yuv` 等编码参数。
- 支持 `width`/`height` 精确尺寸，或 `maxWidth`/`maxHeight` 等比缩小。
- GitHub Actions matrix 构筑这些平台的原生工具：`darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`win32-x64`。
- npm 包运行时按 `process.platform` + `process.arch` 自动选择 `vendor/<platform>-<arch>/` 下的二进制。

## 安装

```sh
npm install libavif-with-gainmap
```

发布前需要先运行本仓库的 GitHub Actions release workflow，生成并打包 `vendor/` 下的原生二进制。

## CLI

```sh
avif-gainmap convert input.jpg output.avif --quality 82 --gain-map-quality 70
avif-gainmap probe input.jpg
```

调整尺寸：

```sh
avif-gainmap convert input.jpg output.avif --max-width 1600 --max-height 1200
avif-gainmap convert input.jpg output.avif --width 1200
```

常用参数：

```sh
avif-gainmap convert input.jpg output.avif \
  --quality 80 \
  --gain-map-quality 65 \
  --speed 6 \
  --jobs all \
  --depth 10 \
  --yuv 420
```

## JS API

```js
const { convertJpegGainMap, probeJpegGainMap } = require('libavif-with-gainmap');

await convertJpegGainMap('input.jpg', 'output.avif', {
  quality: 82,
  gainMapQuality: 70,
  maxWidth: 1600,
  maxHeight: 1200,
  jobs: 'all'
});

const probe = await probeJpegGainMap('input.jpg');
// { hasGainMap: true, input, width, height, gainMap: { width, height, baseHeadroom, alternateHeadroom } }
```

如果只给 `width` 或 `height`，另一边会按比例计算。`maxWidth` / `maxHeight` 只会缩小，不会放大。

默认输出 `YUV420`，优先兼容 Windows 图片查看器等系统解码器。需要更高色度保真度时，可以显式传 `yuv: '444'` 或 CLI `--yuv 444`。

## 消费端测试项目

仓库里有一个独立测试项目：[examples/consumer-test](examples/consumer-test)。

把你自己的 JPEG gain map 图片放到：

```text
examples/consumer-test/images/input.jpg
```

然后执行：

```sh
cd examples/consumer-test
npm install
npm test
```

输出会写到 `examples/consumer-test/outputs/`。

## 原生工具覆盖

默认使用 npm 包内的二进制。也可以用环境变量覆盖：

- `AVIF_GAINMAP_BIN_DIR`: 同时包含 `avifgainmaputil`、`avifgainmapresize` 和 `avifgainmapprobe` 的目录。
- `AVIF_GAINMAPUTIL_PATH`: 指向自定义 `avifgainmaputil`。
- `AVIF_GAINMAPRESIZE_PATH`: 指向自定义 `avifgainmapresize`。
- `AVIF_GAINMAPPROBE_PATH`: 指向自定义 `avifgainmapprobe`。

## 构筑

本项目使用 libavif `v1.4.2`，构筑时开启：

- `AVIF_BUILD_APPS=ON`
- `AVIF_CODEC_AOM=LOCAL`
- `AVIF_JPEG=LOCAL`
- `AVIF_LIBXML2=LOCAL`
- `AVIF_LIBYUV=LOCAL`
- `AVIF_LIBSHARPYUV=LOCAL`
- `AVIF_ZLIBPNG=LOCAL`

本地当前平台构筑：

```sh
npm run build:libavif
npm run check-prebuilt
```

完整发布请看 [docs/BUILDING.md](docs/BUILDING.md)。

## 为什么有 `avifgainmapresize`

普通图片 resize 工具通常不了解 JPEG/AVIF gain map 的主图、辅助图和元数据关系，容易丢失或破坏 gain map。这里先用 libavif 官方工具转换，再用一个链接 libavif 的小工具同时缩放 AVIF base image 和 gain map image，最后按目标质量重新编码。
