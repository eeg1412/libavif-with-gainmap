// Single-pass JPEG gain map to AVIF gain map converter.
//
// This helper reads the JPEG gain map with libavif, applies optional resizing
// directly to the decoded base and gain map images, then writes the final AVIF.

#include "avif/avif.h"
#include "imageio.h"

#include <cerrno>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

namespace {

struct ConvertOptions {
    std::string input;
    std::string output;
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t maxWidth = 0;
    uint32_t maxHeight = 0;
    int quality = 80;
    int qualityAlpha = 80;
    int qualityGainMap = 60;
    int speed = 6;
    int jobs = 1;
    int depth = 0;
    avifPixelFormat yuvFormat = AVIF_PIXEL_FORMAT_YUV420;
    avifBool stripMetadata = AVIF_FALSE;
    avifBool swapBase = AVIF_FALSE;
    avifBool hasCicp = AVIF_FALSE;
    avifColorPrimaries colorPrimaries = AVIF_COLOR_PRIMARIES_UNSPECIFIED;
    avifTransferCharacteristics transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_UNSPECIFIED;
    avifMatrixCoefficients matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_UNSPECIFIED;
    avifContentLightLevelInformationBox clli = {};
};

void printUsage()
{
    std::cerr << "Usage: avifgainmapconvert <input.jpg> <output.avif> [options]\n"
              << "\n"
              << "Options:\n"
              << "  --width N          Exact output width. Keeps aspect if --height is omitted.\n"
              << "  --height N         Exact output height. Keeps aspect if --width is omitted.\n"
              << "  --max-width N      Downscale to fit this width.\n"
              << "  --max-height N     Downscale to fit this height.\n"
              << "  --qcolor N         Color quality, 0-100. Default: 80.\n"
              << "  --qalpha N         Alpha quality, 0-100. Default: same as --qcolor.\n"
              << "  --qgain-map N      Gain map quality, 0-100. Default: 60.\n"
              << "  --speed N          Encoder speed, 0-10. Default: 6.\n"
              << "  --jobs N           Worker threads.\n"
              << "  --depth N          Output bit depth: 8, 10 or 12.\n"
              << "  --yuv FMT          Output YUV format: auto, 444, 422, 420 or 400. Default: 420.\n"
              << "  --cicp P/T/M       Override input CICP values.\n"
              << "  --clli CLL,PALL    Set alternate image light level information.\n"
              << "  --swap-base        Make the HDR image the AVIF base image.\n"
              << "  --strip-metadata   Remove Exif/XMP privacy metadata before writing.\n"
              << "  --help             Show this help.\n";
}

bool parseUnsigned(const char * value, const char * name, uint32_t min, uint32_t max, uint32_t * out)
{
    char * end = nullptr;
    errno = 0;
    const unsigned long parsed = std::strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed < min || parsed > max) {
        std::cerr << name << " must be between " << min << " and " << max << ".\n";
        return false;
    }
    *out = static_cast<uint32_t>(parsed);
    return true;
}

bool parseInt(const char * value, const char * name, int min, int max, int * out)
{
    char * end = nullptr;
    errno = 0;
    const long parsed = std::strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed < min || parsed > max) {
        std::cerr << name << " must be between " << min << " and " << max << ".\n";
        return false;
    }
    *out = static_cast<int>(parsed);
    return true;
}

bool readOptionValue(int argc, char ** argv, int * index, const char ** value)
{
    if (*index + 1 >= argc) {
        std::cerr << argv[*index] << " requires a value.\n";
        return false;
    }
    *index += 1;
    *value = argv[*index];
    return true;
}

bool parseCicp(const char * value, ConvertOptions * options)
{
    int p = 0;
    int t = 0;
    int m = 0;
    char trailing = 0;
    if (std::sscanf(value, "%d/%d/%d%c", &p, &t, &m, &trailing) != 3 || p < 0 || t < 0 || m < 0 ||
        p > UINT16_MAX || t > UINT16_MAX || m > UINT16_MAX) {
        std::cerr << "--cicp must use P/T/M with 16-bit unsigned integer values.\n";
        return false;
    }
    options->hasCicp = AVIF_TRUE;
    options->colorPrimaries = static_cast<avifColorPrimaries>(p);
    options->transferCharacteristics = static_cast<avifTransferCharacteristics>(t);
    options->matrixCoefficients = static_cast<avifMatrixCoefficients>(m);
    return true;
}

bool parseClli(const char * value, ConvertOptions * options)
{
    int maxCLL = 0;
    int maxPALL = 0;
    char trailing = 0;
    if (std::sscanf(value, "%d,%d%c", &maxCLL, &maxPALL, &trailing) != 2 || maxCLL < 0 || maxPALL < 0 ||
        maxCLL > UINT16_MAX || maxPALL > UINT16_MAX) {
        std::cerr << "--clli must use MaxCLL,MaxPALL with 16-bit unsigned integer values.\n";
        return false;
    }
    options->clli.maxCLL = static_cast<uint16_t>(maxCLL);
    options->clli.maxPALL = static_cast<uint16_t>(maxPALL);
    return true;
}

bool parseYuv(const char * value, avifPixelFormat * yuvFormat)
{
    if (std::strcmp(value, "auto") == 0) {
        *yuvFormat = AVIF_PIXEL_FORMAT_NONE;
    } else if (std::strcmp(value, "444") == 0) {
        *yuvFormat = AVIF_PIXEL_FORMAT_YUV444;
    } else if (std::strcmp(value, "422") == 0) {
        *yuvFormat = AVIF_PIXEL_FORMAT_YUV422;
    } else if (std::strcmp(value, "420") == 0) {
        *yuvFormat = AVIF_PIXEL_FORMAT_YUV420;
    } else if (std::strcmp(value, "400") == 0) {
        *yuvFormat = AVIF_PIXEL_FORMAT_YUV400;
    } else {
        std::cerr << "--yuv must be one of: auto, 444, 422, 420, 400.\n";
        return false;
    }
    return true;
}

bool parseArgs(int argc, char ** argv, ConvertOptions * options)
{
    if (argc == 2 && (std::strcmp(argv[1], "--help") == 0 || std::strcmp(argv[1], "-h") == 0)) {
        printUsage();
        std::exit(0);
    }
    if (argc < 3) {
        printUsage();
        return false;
    }

    options->input = argv[1];
    options->output = argv[2];

    for (int i = 3; i < argc; ++i) {
        const char * value = nullptr;
        if (std::strcmp(argv[i], "--help") == 0 || std::strcmp(argv[i], "-h") == 0) {
            printUsage();
            std::exit(0);
        } else if (std::strcmp(argv[i], "--width") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--width", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->width)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--height") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--height", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->height)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--max-width") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--max-width", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->maxWidth)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--max-height") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--max-height", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->maxHeight)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--qcolor") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qcolor", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->quality)) {
                return false;
            }
            options->qualityAlpha = options->quality;
        } else if (std::strcmp(argv[i], "--qalpha") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qalpha", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->qualityAlpha)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--qgain-map") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qgain-map", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->qualityGainMap)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--speed") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--speed", AVIF_SPEED_SLOWEST, AVIF_SPEED_FASTEST, &options->speed)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--jobs") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseInt(value, "--jobs", 1, 1024, &options->jobs)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--depth") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseInt(value, "--depth", 8, 12, &options->depth) ||
                (options->depth != 8 && options->depth != 10 && options->depth != 12)) {
                std::cerr << "--depth must be 8, 10 or 12.\n";
                return false;
            }
        } else if (std::strcmp(argv[i], "--yuv") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseYuv(value, &options->yuvFormat)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--cicp") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseCicp(value, options)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--clli") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseClli(value, options)) {
                return false;
            }
        } else if (std::strcmp(argv[i], "--swap-base") == 0) {
            options->swapBase = AVIF_TRUE;
        } else if (std::strcmp(argv[i], "--strip-metadata") == 0) {
            options->stripMetadata = AVIF_TRUE;
        } else {
            std::cerr << "Unknown option " << argv[i] << ".\n";
            return false;
        }
    }

    if ((options->width || options->height) && (options->maxWidth || options->maxHeight)) {
        std::cerr << "Use --width/--height or --max-width/--max-height, not both.\n";
        return false;
    }
    return true;
}

uint32_t scaleDimension(uint32_t value, uint32_t numerator, uint32_t denominator)
{
    if (denominator == 0) {
        return 1;
    }
    uint64_t scaled = (static_cast<uint64_t>(value) * numerator) + (denominator / 2);
    scaled /= denominator;
    if (scaled < 1) {
        return 1;
    }
    if (scaled > AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT) {
        return AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT;
    }
    return static_cast<uint32_t>(scaled);
}

bool computeTargetSize(const ConvertOptions & options,
                       uint32_t sourceWidth,
                       uint32_t sourceHeight,
                       uint32_t * targetWidth,
                       uint32_t * targetHeight)
{
    *targetWidth = sourceWidth;
    *targetHeight = sourceHeight;

    if (options.width && options.height) {
        *targetWidth = options.width;
        *targetHeight = options.height;
    } else if (options.width) {
        *targetWidth = options.width;
        *targetHeight = scaleDimension(sourceHeight, options.width, sourceWidth);
    } else if (options.height) {
        *targetWidth = scaleDimension(sourceWidth, options.height, sourceHeight);
        *targetHeight = options.height;
    } else {
        if (options.maxWidth && *targetWidth > options.maxWidth) {
            *targetHeight = scaleDimension(*targetHeight, options.maxWidth, *targetWidth);
            *targetWidth = options.maxWidth;
        }
        if (options.maxHeight && *targetHeight > options.maxHeight) {
            *targetWidth = scaleDimension(*targetWidth, options.maxHeight, *targetHeight);
            *targetHeight = options.maxHeight;
        }
    }

    const uint64_t pixels = static_cast<uint64_t>(*targetWidth) * (*targetHeight);
    if (*targetWidth == 0 || *targetHeight == 0 || pixels > AVIF_DEFAULT_IMAGE_SIZE_LIMIT) {
        std::cerr << "Target size " << *targetWidth << " x " << *targetHeight
                  << " exceeds libavif's default image limits.\n";
        return false;
    }
    return true;
}

avifResult scaleImage(avifImage * image, uint32_t width, uint32_t height, const char * label)
{
    if (image->width == width && image->height == height) {
        return AVIF_RESULT_OK;
    }
    avifDiagnostics diag;
    std::memset(&diag, 0, sizeof(diag));
    const avifResult result = avifImageScale(image, width, height, &diag);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to scale " << label << " to " << width << " x " << height << ": "
                  << avifResultToString(result) << " (" << diag.error << ")\n";
    }
    return result;
}

void stripMetadata(avifImage * image)
{
    avifRWDataFree(&image->exif);
    avifRWDataFree(&image->xmp);
    if (image->gainMap && image->gainMap->image) {
        avifRWDataFree(&image->gainMap->image->exif);
        avifRWDataFree(&image->gainMap->image->xmp);
    }
}

void resetExifOrientation(avifImage * image)
{
    size_t orientationOffset = 0;
    if (image->exif.data != nullptr &&
        avifGetExifOrientationOffset(image->exif.data, image->exif.size, &orientationOffset) == AVIF_RESULT_OK &&
        orientationOffset < image->exif.size) {
        image->exif.data[orientationOffset] = 1;
    }
}

uint32_t roundedShift(uint32_t value, int shift)
{
    return shift > 0 ? ((value + ((1u << shift) - 1u)) >> shift) : value;
}

void planeSize(const avifImage * image, int plane, uint32_t * width, uint32_t * height)
{
    if (plane == AVIF_CHAN_A || plane == AVIF_CHAN_Y) {
        *width = image->width;
        *height = image->height;
        return;
    }

    avifPixelFormatInfo info;
    avifGetPixelFormatInfo(image->yuvFormat, &info);
    if (info.monochrome) {
        *width = 0;
        *height = 0;
        return;
    }
    *width = roundedShift(image->width, info.chromaShiftX);
    *height = roundedShift(image->height, info.chromaShiftY);
}

void orientedSize(uint32_t width, uint32_t height, uint8_t angle, uint32_t * orientedWidth, uint32_t * orientedHeight)
{
    if ((angle & 1) != 0) {
        *orientedWidth = height;
        *orientedHeight = width;
    } else {
        *orientedWidth = width;
        *orientedHeight = height;
    }
}

void transformCoordinates(uint32_t x,
                          uint32_t y,
                          uint32_t width,
                          uint32_t height,
                          avifBool mirror,
                          uint8_t mirrorAxis,
                          uint8_t angle,
                          uint32_t * outX,
                          uint32_t * outY)
{
    if (mirror) {
        if (mirrorAxis == 0) {
            y = height - 1 - y;
        } else {
            x = width - 1 - x;
        }
    }

    switch (angle & 3) {
        case 1:
            *outX = y;
            *outY = width - 1 - x;
            break;
        case 2:
            *outX = width - 1 - x;
            *outY = height - 1 - y;
            break;
        case 3:
            *outX = height - 1 - y;
            *outY = x;
            break;
        default:
            *outX = x;
            *outY = y;
            break;
    }
}

void transformPlane(const uint8_t * src,
                    uint32_t srcRowBytes,
                    uint8_t * dst,
                    uint32_t dstRowBytes,
                    uint32_t srcWidth,
                    uint32_t srcHeight,
                    uint32_t sampleBytes,
                    avifBool mirror,
                    uint8_t mirrorAxis,
                    uint8_t angle)
{
    for (uint32_t y = 0; y < srcHeight; ++y) {
        const uint8_t * srcRow = src + (static_cast<size_t>(srcRowBytes) * y);
        for (uint32_t x = 0; x < srcWidth; ++x) {
            uint32_t dstX = 0;
            uint32_t dstY = 0;
            transformCoordinates(x, y, srcWidth, srcHeight, mirror, mirrorAxis, angle, &dstX, &dstY);
            std::memcpy(dst + (static_cast<size_t>(dstRowBytes) * dstY) + (static_cast<size_t>(dstX) * sampleBytes),
                        srcRow + (static_cast<size_t>(x) * sampleBytes),
                        sampleBytes);
        }
    }
}

avifResult bakeOrientationIntoPixels(avifImage * image,
                                     avifTransformFlags transformFlags,
                                     avifImageRotation irot,
                                     avifImageMirror imir)
{
    const avifBool hasRotation = (transformFlags & AVIF_TRANSFORM_IROT) != 0;
    const avifBool hasMirror = (transformFlags & AVIF_TRANSFORM_IMIR) != 0;
    if (!hasRotation && !hasMirror) {
        return AVIF_RESULT_OK;
    }

    const uint8_t angle = hasRotation ? (irot.angle & 3) : 0;
    uint32_t orientedWidth = 0;
    uint32_t orientedHeight = 0;
    orientedSize(image->width, image->height, angle, &orientedWidth, &orientedHeight);

    avifImage * oriented = avifImageCreate(orientedWidth, orientedHeight, image->depth, image->yuvFormat);
    if (oriented == nullptr) {
        return AVIF_RESULT_OUT_OF_MEMORY;
    }
    oriented->yuvRange = image->yuvRange;
    oriented->yuvChromaSamplePosition = image->yuvChromaSamplePosition;
    oriented->alphaPremultiplied = image->alphaPremultiplied;

    avifPlanesFlags planes = 0;
    if (image->yuvPlanes[AVIF_CHAN_Y] != nullptr) {
        planes |= AVIF_PLANES_YUV;
    }
    if (image->alphaPlane != nullptr) {
        planes |= AVIF_PLANES_A;
    }

    avifResult result = avifImageAllocatePlanes(oriented, planes);
    if (result != AVIF_RESULT_OK) {
        avifImageDestroy(oriented);
        return result;
    }

    const uint32_t sampleBytes = image->depth > 8 ? 2 : 1;
    for (int plane = AVIF_CHAN_Y; plane <= AVIF_CHAN_V; ++plane) {
        if (image->yuvPlanes[plane] == nullptr || oriented->yuvPlanes[plane] == nullptr) {
            continue;
        }
        uint32_t srcWidth = 0;
        uint32_t srcHeight = 0;
        planeSize(image, plane, &srcWidth, &srcHeight);
        transformPlane(image->yuvPlanes[plane],
                       image->yuvRowBytes[plane],
                       oriented->yuvPlanes[plane],
                       oriented->yuvRowBytes[plane],
                       srcWidth,
                       srcHeight,
                       sampleBytes,
                       hasMirror,
                       imir.axis,
                       angle);
    }

    if (image->alphaPlane != nullptr && oriented->alphaPlane != nullptr) {
        transformPlane(image->alphaPlane,
                       image->alphaRowBytes,
                       oriented->alphaPlane,
                       oriented->alphaRowBytes,
                       image->width,
                       image->height,
                       sampleBytes,
                       hasMirror,
                       imir.axis,
                       angle);
    }

    avifImageFreePlanes(image, planes);
    image->width = oriented->width;
    image->height = oriented->height;
    avifImageStealPlanes(image, oriented, planes);
    avifImageDestroy(oriented);

    image->transformFlags &= ~(AVIF_TRANSFORM_IROT | AVIF_TRANSFORM_IMIR);
    image->irot.angle = 0;
    image->imir.axis = 0;
    resetExifOrientation(image);
    return AVIF_RESULT_OK;
}

avifResult bakeImageOrientation(avifImage * image)
{
    const avifTransformFlags transformFlags = image->transformFlags;
    const avifImageRotation irot = image->irot;
    const avifImageMirror imir = image->imir;
    if ((transformFlags & (AVIF_TRANSFORM_IROT | AVIF_TRANSFORM_IMIR)) == 0) {
        return AVIF_RESULT_OK;
    }

    avifResult result = bakeOrientationIntoPixels(image, transformFlags, irot, imir);
    if (result != AVIF_RESULT_OK) {
        return result;
    }

    if (image->gainMap && image->gainMap->image) {
        result = bakeOrientationIntoPixels(image->gainMap->image, transformFlags, irot, imir);
        if (result != AVIF_RESULT_OK) {
            return result;
        }
    }
    return AVIF_RESULT_OK;
}

bool normalizeGainMapMetadata(avifImage * image)
{
    if (image->gainMap == nullptr || image->gainMap->image == nullptr) {
        std::cerr << "Input image does not contain a gain map.\n";
        return false;
    }
    if (image->gainMap->altICC.size == 0) {
        if (image->gainMap->altColorPrimaries == AVIF_COLOR_PRIMARIES_UNSPECIFIED) {
            image->gainMap->altColorPrimaries = image->colorPrimaries;
        }
        if (image->gainMap->altTransferCharacteristics == AVIF_TRANSFER_CHARACTERISTICS_UNSPECIFIED) {
            image->gainMap->altTransferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_PQ;
        }
    }
    return true;
}

avifResult changeBase(const avifImage & image, int depth, avifPixelFormat yuvFormat, avifImage * swapped)
{
    if (image.gainMap == nullptr || image.gainMap->image == nullptr) {
        return AVIF_RESULT_INVALID_ARGUMENT;
    }

    avifResult result = avifImageCopy(swapped, &image, /*planes=*/0);
    if (result != AVIF_RESULT_OK) {
        return result;
    }
    swapped->depth = depth;
    swapped->yuvFormat = yuvFormat;

    if (image.gainMap->alternateHdrHeadroom.d == 0) {
        return AVIF_RESULT_INVALID_ARGUMENT;
    }
    const float headroom =
        static_cast<float>(image.gainMap->alternateHdrHeadroom.n) / image.gainMap->alternateHdrHeadroom.d;
    const bool toneMappingToSdr = (headroom == 0.0f);

    swapped->colorPrimaries = image.gainMap->altColorPrimaries;
    if (swapped->colorPrimaries == AVIF_COLOR_PRIMARIES_UNSPECIFIED) {
        swapped->colorPrimaries = image.colorPrimaries;
    }
    swapped->transferCharacteristics = image.gainMap->altTransferCharacteristics;
    if (swapped->transferCharacteristics == AVIF_TRANSFER_CHARACTERISTICS_UNSPECIFIED) {
        swapped->transferCharacteristics =
            toneMappingToSdr ? AVIF_TRANSFER_CHARACTERISTICS_SRGB : AVIF_TRANSFER_CHARACTERISTICS_PQ;
    }
    swapped->matrixCoefficients = image.gainMap->altMatrixCoefficients;
    if (swapped->matrixCoefficients == AVIF_MATRIX_COEFFICIENTS_UNSPECIFIED) {
        swapped->matrixCoefficients = image.matrixCoefficients;
    }

    avifRGBImage swappedRgb;
    avifRGBImageSetDefaults(&swappedRgb, swapped);
    avifContentLightLevelInformationBox clli = image.gainMap->altCLLI;
    const bool computeClli = !toneMappingToSdr && clli.maxCLL == 0 && clli.maxPALL == 0;
    avifDiagnostics diag;
    std::memset(&diag, 0, sizeof(diag));

    result = avifImageApplyGainMap(&image,
                                   image.gainMap,
                                   headroom,
                                   swapped->colorPrimaries,
                                   swapped->transferCharacteristics,
                                   &swappedRgb,
                                   computeClli ? &clli : nullptr,
                                   &diag);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to tone map image: " << avifResultToString(result) << " (" << diag.error << ")\n";
        avifRGBImageFreePixels(&swappedRgb);
        return result;
    }

    result = avifImageRGBToYUV(swapped, &swappedRgb);
    avifRGBImageFreePixels(&swappedRgb);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to convert to YUV: " << avifResultToString(result) << "\n";
        return result;
    }
    swapped->clli = clli;

    result = avifImageCopy(swapped->gainMap->image, image.gainMap->image, AVIF_PLANES_YUV);
    if (result != AVIF_RESULT_OK) {
        return result;
    }

    result = avifRWDataSet(&swapped->gainMap->altICC, image.icc.data, image.icc.size);
    if (result != AVIF_RESULT_OK) {
        return result;
    }
    swapped->gainMap->altColorPrimaries = image.colorPrimaries;
    swapped->gainMap->altTransferCharacteristics = image.transferCharacteristics;
    swapped->gainMap->altMatrixCoefficients = image.matrixCoefficients;
    swapped->gainMap->altYUVRange = image.yuvRange;
    swapped->gainMap->altDepth = image.depth;
    swapped->gainMap->altPlaneCount = (image.yuvFormat == AVIF_PIXEL_FORMAT_YUV400) ? 1 : 3;
    swapped->gainMap->altCLLI = image.clli;

    avifGainMap * gainMap = swapped->gainMap;
    gainMap->useBaseColorSpace = !gainMap->useBaseColorSpace;
    std::swap(gainMap->baseHdrHeadroom, gainMap->alternateHdrHeadroom);
    for (int c = 0; c < 3; ++c) {
        std::swap(gainMap->baseOffset[c], gainMap->alternateOffset[c]);
    }
    return AVIF_RESULT_OK;
}

avifResult resizeGainMapImage(avifImage * image, const ConvertOptions & options)
{
    const uint32_t sourceWidth = image->width;
    const uint32_t sourceHeight = image->height;
    const uint32_t sourceGainMapWidth = image->gainMap->image->width;
    const uint32_t sourceGainMapHeight = image->gainMap->image->height;

    uint32_t targetWidth = 0;
    uint32_t targetHeight = 0;
    if (!computeTargetSize(options, sourceWidth, sourceHeight, &targetWidth, &targetHeight)) {
        return AVIF_RESULT_INVALID_ARGUMENT;
    }

    avifResult result = scaleImage(image, targetWidth, targetHeight, "base image");
    if (result != AVIF_RESULT_OK) {
        return result;
    }

    const uint32_t targetGainMapWidth = scaleDimension(sourceGainMapWidth, targetWidth, sourceWidth);
    const uint32_t targetGainMapHeight = scaleDimension(sourceGainMapHeight, targetHeight, sourceHeight);
    return scaleImage(image->gainMap->image, targetGainMapWidth, targetGainMapHeight, "gain map image");
}

bool writeFile(const char * path, const avifRWData * data)
{
    FILE * file = std::fopen(path, "wb");
    if (!file) {
        std::cerr << "Failed to open " << path << " for writing.\n";
        return false;
    }
    const size_t written = std::fwrite(data->data, 1, data->size, file);
    const int closeResult = std::fclose(file);
    if (written != data->size || closeResult != 0) {
        std::cerr << "Failed to write " << path << ".\n";
        return false;
    }
    return true;
}

} // namespace

int main(int argc, char ** argv)
{
#if !defined(AVIF_ENABLE_JPEG_GAIN_MAP_CONVERSION)
    std::cerr << "JPEG gain map conversion unavailable because libavif was not built with libxml2.\n";
    return 3;
#else
    ConvertOptions options;
    if (!parseArgs(argc, argv, &options)) {
        return 1;
    }

    avifImage * image = avifImageCreateEmpty();
    avifImage * swapped = nullptr;
    avifEncoder * encoder = nullptr;
    avifRWData encoded = AVIF_DATA_EMPTY;
    avifResult result = AVIF_RESULT_OK;
    int exitCode = 1;

    if (image == nullptr) {
        std::cerr << "Out of memory.\n";
        goto cleanup;
    }
    if (options.hasCicp) {
        image->colorPrimaries = options.colorPrimaries;
        image->transferCharacteristics = options.transferCharacteristics;
        image->matrixCoefficients = options.matrixCoefficients;
    }

    result = avif::ReadImage(image,
                             options.input,
                             options.yuvFormat,
                             options.depth,
                             /*ignore_profile=*/false,
                             /*ignore_gain_map=*/false,
                             options.jobs);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to decode image: " << options.input << ": " << avifResultToString(result) << "\n";
        goto cleanup;
    }
    if (!normalizeGainMapMetadata(image)) {
        goto cleanup;
    }
    image->gainMap->altCLLI = options.clli;

    result = bakeImageOrientation(image);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to apply image orientation: " << avifResultToString(result) << "\n";
        goto cleanup;
    }

    if (options.swapBase) {
        int depth = options.depth;
        if (depth == 0) {
            depth = image->gainMap->alternateHdrHeadroom.n == 0 ? 8 : 10;
        }
        swapped = avifImageCreateEmpty();
        if (swapped == nullptr) {
            std::cerr << "Out of memory.\n";
            goto cleanup;
        }
        result = changeBase(*image, depth, image->yuvFormat, swapped);
        if (result != AVIF_RESULT_OK) {
            std::cerr << "Failed to swap base image: " << avifResultToString(result) << "\n";
            goto cleanup;
        }
        avifImageDestroy(image);
        image = swapped;
        swapped = nullptr;
    }

    result = resizeGainMapImage(image, options);
    if (result != AVIF_RESULT_OK) {
        goto cleanup;
    }
    if (options.stripMetadata) {
        stripMetadata(image);
    }

    encoder = avifEncoderCreate();
    if (encoder == nullptr) {
        std::cerr << "Out of memory.\n";
        goto cleanup;
    }
    encoder->quality = options.quality;
    encoder->qualityAlpha = options.qualityAlpha;
    encoder->qualityGainMap = options.qualityGainMap;
    encoder->speed = options.speed;
    encoder->maxThreads = options.jobs;
    encoder->autoTiling = AVIF_TRUE;

    result = avifEncoderWrite(encoder, image, &encoded);
    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to encode " << options.output << ": " << avifResultToString(result) << " ("
                  << encoder->diag.error << ")\n";
        goto cleanup;
    }
    if (!writeFile(options.output.c_str(), &encoded)) {
        goto cleanup;
    }

    exitCode = 0;

cleanup:
    avifRWDataFree(&encoded);
    if (encoder) {
        avifEncoderDestroy(encoder);
    }
    if (swapped) {
        avifImageDestroy(swapped);
    }
    if (image) {
        avifImageDestroy(image);
    }
    return exitCode;
#endif
}
