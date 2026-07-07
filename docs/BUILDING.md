# 构筑和发布

## GitHub Actions

`.github/workflows/release.yml` 会做三件事：

1. 跑 JS 测试。
2. 用 matrix 分别构筑五个平台的 libavif 工具：
   - `linux-x64` on `ubuntu-22.04`
   - `linux-arm64` on `ubuntu-22.04-arm`
   - `darwin-x64` on `macos-15-intel`
   - `darwin-arm64` on `macos-14`
   - `win32-x64` on `windows-2022`
3. 对每个平台的二进制做依赖审计，汇总 `vendor/<platform>-<arch>/` 后执行 `npm pack`，tag 触发时再用 npm Trusted Publishing 发布。

手动运行 workflow 只会构筑和打包，不会发布。只有推送 `v*` tag 时，`publish npm` job 才会运行。

## 原生二进制门禁

发布包不是只检查文件是否存在。`npm run check-prebuilt` 会执行这些硬检查：

- Windows: 解析 PE import table，要求 `win32-x64` 架构正确，禁止 MinGW runtime DLL 和动态 MSVC runtime DLL。
- Linux: 解析 ELF header，要求 `x64` / `arm64` 架构正确；用 `readelf` 检查动态库，只允许 glibc 系统库和系统动态加载器；要求 GLIBC 版本不高于 `2.35`。
- macOS: 直接解析 Mach-O header 和 load commands，要求 `x64` / `arm64` 架构正确，禁止 Homebrew/非系统 dylib，要求最低 macOS 版本不高于 `12.0`。

如果这些检查失败，workflow 必须失败，不能发布。

## npm Trusted Publishing

本仓库使用 npm Trusted Publishing/OIDC，不需要 `NPM_TOKEN`。

在 npmjs.com 配置：

1. 打开 package 的 Settings。
2. 找到 Trusted publishing。
3. 选择 GitHub Actions。
4. 填写：
   - Organization or user: `eeg1412`
   - Repository: `libavif-with-gainmap`
   - Workflow filename: `release.yml`
   - Allowed actions: `npm publish`

npm 官方要求 Trusted Publishing 使用支持 OIDC 的云端 CI runner。这个 workflow 已经配置：

```yaml
permissions:
  contents: read
  id-token: write
```

正式发布：

```sh
git tag v0.1.7
git push origin v0.1.7
```

## 本地构筑当前平台

需要 `git`、`cmake`、`ninja`、`nasm`、Node.js 18+。Windows 构筑必须能直接执行 `nasm -v`，否则 `aom` 的 CMake 配置会失败。

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
  avifgainmapprobe(.exe)
```

## 可配置环境变量

- `LIBAVIF_VERSION`: 默认 `v1.4.2`。
- `LIBAVIF_SOURCE_DIR`: 使用已有 libavif 源码目录，而不是自动 clone。
- `LIBAVIF_BUILD_DIR`: 自定义 CMake build 目录。
- `LIBAVIF_INSTALL_DIR`: 自定义 CMake install 目录。
- `LIBAVIF_CMAKE_ARGS`: 追加 CMake 参数。
- `TARGET_PLATFORM_KEY`: 写入哪个 `vendor/<key>` 目录，默认当前平台。
- `MACOSX_DEPLOYMENT_TARGET`: macOS 最低部署版本，默认 `12.0`。

示例：

```sh
LIBAVIF_VERSION=v1.4.2 TARGET_PLATFORM_KEY=linux-x64 npm run build:libavif
```

## 构筑策略

libavif 是 C/C++ 原生项目，不能构筑一个跨所有系统通用的二进制。本仓库选择在 GitHub Actions 上按平台分别构筑，然后把产物放入 npm tarball。运行时由 Node.js 选择当前平台的二进制。

`avifgainmaputil` 来自 libavif；`avifgainmapresize` 是本仓库的很小一层 C helper，通过 public libavif API 解码、缩放、重编码 AVIF gain map；`avifgainmapprobe` 是本仓库的 C++ helper，复用 libavif 的 JPEG gain map 读取逻辑，只解析并检测 JPEG 是否包含可用 gain map，不编码 AVIF。
