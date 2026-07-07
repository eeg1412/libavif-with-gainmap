# 构筑和发布

## GitHub Actions

`.github/workflows/release.yml` 会做三件事：

1. 跑 JS 测试。
2. 用 matrix 分别构筑五个平台的 libavif 工具：
   - `linux-x64` on `ubuntu-24.04`
   - `linux-arm64` on `ubuntu-24.04-arm`
   - `darwin-x64` on `macos-15-intel`
   - `darwin-arm64` on `macos-15`
   - `win32-x64` on `windows-2025`
3. 汇总 `vendor/<platform>-<arch>/` 后执行 `npm pack`，tag 触发时再 `npm publish`。

发布到 npm 前，在仓库 secrets 里配置：

```text
NPM_TOKEN=<npm automation token>
```

然后创建 tag：

```sh
git tag v0.1.0
git push origin v0.1.0
```

## 本地构筑当前平台

需要 `git`、`cmake`、`ninja`、`nasm`、Node.js 18+。

```sh
npm test
npm run build:libavif
npm run check-prebuilt
```

输出目录：

```text
vendor/<platform>-<arch>/
  avifgainmaputil(.exe)
  avifgainmapresize(.exe)
```

## 可配置环境变量

- `LIBAVIF_VERSION`: 默认 `v1.4.2`。
- `LIBAVIF_SOURCE_DIR`: 使用已有 libavif 源码目录，而不是自动 clone。
- `LIBAVIF_BUILD_DIR`: 自定义 CMake build 目录。
- `LIBAVIF_INSTALL_DIR`: 自定义 CMake install 目录。
- `LIBAVIF_CMAKE_ARGS`: 追加 CMake 参数。
- `TARGET_PLATFORM_KEY`: 写入哪个 `vendor/<key>` 目录，默认当前平台。

示例：

```sh
LIBAVIF_VERSION=v1.4.2 TARGET_PLATFORM_KEY=linux-x64 npm run build:libavif
```

## 构筑策略

libavif 是 C/C++ 原生项目，不能构筑一个跨所有系统通用的二进制。本仓库选择在 GitHub Actions 上按平台分别构筑，然后把产物放入 npm tarball。运行时由 Node.js 选择当前平台的二进制。

`avifgainmaputil` 来自 libavif；`avifgainmapresize` 是本仓库的很小一层 C helper，通过 public libavif API 解码、缩放、重编码 AVIF gain map。
