# Consumer Test

这个目录是一个独立的消费端测试项目，用来验证已经发布到 npm 的 `libavif-with-gainmap` 是否可以把 JPEG gain map 转成 AVIF gain map。

## 准备图片

把你自己的 JPEG gain map 图片放到：

```text
examples/consumer-test/images/input.jpg
```

也可以运行时指定路径：

```sh
npm test -- --input D:\path\to\your\image.jpg
```

## 安装依赖

在这个目录执行：

```sh
npm install
```

这会从 npm 安装已发布的 `libavif-with-gainmap`，不是使用仓库源码。

## 运行测试

同时测试 JS API 和 CLI：

```sh
npm test
```

只测试 JS API：

```sh
npm run test:api
```

只测试 CLI：

```sh
npm run test:cli
```

输出文件：

```text
examples/consumer-test/outputs/api-output-<runId>.avif
examples/consumer-test/outputs/cli-output-<runId>.avif
```

`<runId>` 会随每次运行变化，避免 Windows 上旧输出文件被图片查看器或其他进程占用时导致覆盖失败。

脚本会先调用 `probeJpegGainMap()` 严格检测输入 JPEG 是否包含可由 libavif 解析的 gain map，然后检查输出文件是否存在、是否非空、文件头是否是 AVIF/ISOBMFF。

## 可选参数

```sh
npm test -- --quality 82 --gain-map-quality 70 --max-width 1600 --max-height 1200 --yuv 420
```

常用参数：

- `--input <path>`: 输入 JPEG，默认 `images/input.jpg`。
- `--output-dir <path>`: 输出目录，默认 `outputs`。
- `--mode api|cli|both`: 测试模式，默认 `both`。
- `--quality <0-100>`: 主图质量，默认 `80`。
- `--gain-map-quality <0-100>`: gain map 质量，默认 `65`。
- `--max-width <px>`: 最大宽度，默认 `1600`。
- `--max-height <px>`: 最大高度，默认 `1200`。
- `--yuv <444|422|420|400>`: 输出 YUV 格式，默认 `420`。Windows 图片查看器兼容性优先时使用 `420`；需要对比色度保真度时可试 `444`。
- `--jobs <n|all>`: 线程数，默认 `all`。
