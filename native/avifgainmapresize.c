// Small package-specific helper built next to libavif.
// It decodes an AVIF gain map image, scales the base image and gain map image
// with libavif's scaler, then writes a new AVIF with caller-controlled quality.

#include "avif/avif.h"

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct ResizeOptions {
    const char * input;
    const char * output;
    uint32_t width;
    uint32_t height;
    uint32_t maxWidth;
    uint32_t maxHeight;
    int quality;
    int qualityAlpha;
    int qualityGainMap;
    int speed;
    int jobs;
} ResizeOptions;

static void printUsage(void)
{
    fprintf(stderr,
            "Usage: avifgainmapresize <input.avif> <output.avif> [options]\n"
            "\n"
            "Options:\n"
            "  --width N          Exact output width. Keeps aspect if --height is omitted.\n"
            "  --height N         Exact output height. Keeps aspect if --width is omitted.\n"
            "  --max-width N      Downscale to fit this width.\n"
            "  --max-height N     Downscale to fit this height.\n"
            "  --qcolor N         Color quality, 0-100. Default: 80.\n"
            "  --qalpha N         Alpha quality, 0-100. Default: same as --qcolor.\n"
            "  --qgain-map N      Gain map quality, 0-100. Default: 60.\n"
            "  --speed N          Encoder speed, 0-10. Default: 6.\n"
            "  --jobs N           Worker threads.\n"
            "  --help             Show this help.\n");
}

static avifBool parseUnsigned(const char * value, const char * name, uint32_t min, uint32_t max, uint32_t * out)
{
    char * end = NULL;
    errno = 0;
    const unsigned long parsed = strtoul(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed < min || parsed > max) {
        fprintf(stderr, "%s must be between %u and %u.\n", name, min, max);
        return AVIF_FALSE;
    }
    *out = (uint32_t)parsed;
    return AVIF_TRUE;
}

static avifBool parseInt(const char * value, const char * name, int min, int max, int * out)
{
    char * end = NULL;
    errno = 0;
    const long parsed = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed < min || parsed > max) {
        fprintf(stderr, "%s must be between %d and %d.\n", name, min, max);
        return AVIF_FALSE;
    }
    *out = (int)parsed;
    return AVIF_TRUE;
}

static avifBool readOptionValue(int argc, char ** argv, int * index, const char ** value)
{
    if (*index + 1 >= argc) {
        fprintf(stderr, "%s requires a value.\n", argv[*index]);
        return AVIF_FALSE;
    }
    *index += 1;
    *value = argv[*index];
    return AVIF_TRUE;
}

static avifBool parseArgs(int argc, char ** argv, ResizeOptions * options)
{
    options->quality = 80;
    options->qualityAlpha = -1;
    options->qualityGainMap = 60;
    options->speed = 6;

    if (argc == 2 && strcmp(argv[1], "--help") == 0) {
        printUsage();
        exit(0);
    }
    if (argc < 3) {
        printUsage();
        return AVIF_FALSE;
    }

    options->input = argv[1];
    options->output = argv[2];

    for (int i = 3; i < argc; ++i) {
        const char * value = NULL;
        if (strcmp(argv[i], "--help") == 0) {
            printUsage();
            exit(0);
        } else if (strcmp(argv[i], "--width") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--width", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->width)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--height") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--height", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->height)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--max-width") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--max-width", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->maxWidth)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--max-height") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseUnsigned(value, "--max-height", 1, AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT, &options->maxHeight)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--qcolor") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qcolor", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->quality)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--qalpha") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qalpha", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->qualityAlpha)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--qgain-map") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--qgain-map", AVIF_QUALITY_WORST, AVIF_QUALITY_BEST, &options->qualityGainMap)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--speed") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) ||
                !parseInt(value, "--speed", AVIF_SPEED_SLOWEST, AVIF_SPEED_FASTEST, &options->speed)) {
                return AVIF_FALSE;
            }
        } else if (strcmp(argv[i], "--jobs") == 0) {
            if (!readOptionValue(argc, argv, &i, &value) || !parseInt(value, "--jobs", 1, 1024, &options->jobs)) {
                return AVIF_FALSE;
            }
        } else {
            fprintf(stderr, "Unknown option %s.\n", argv[i]);
            return AVIF_FALSE;
        }
    }

    if ((options->width || options->height) && (options->maxWidth || options->maxHeight)) {
        fprintf(stderr, "Use --width/--height or --max-width/--max-height, not both.\n");
        return AVIF_FALSE;
    }
    if (options->qualityAlpha < 0) {
        options->qualityAlpha = options->quality;
    }
    return AVIF_TRUE;
}

static uint32_t scaleDimension(uint32_t value, uint32_t numerator, uint32_t denominator)
{
    if (denominator == 0) {
        return 1;
    }
    uint64_t scaled = ((uint64_t)value * numerator) + (denominator / 2);
    scaled /= denominator;
    if (scaled < 1) {
        return 1;
    }
    if (scaled > AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT) {
        return AVIF_DEFAULT_IMAGE_DIMENSION_LIMIT;
    }
    return (uint32_t)scaled;
}

static avifBool computeTargetSize(const ResizeOptions * options,
                                  uint32_t sourceWidth,
                                  uint32_t sourceHeight,
                                  uint32_t * targetWidth,
                                  uint32_t * targetHeight)
{
    *targetWidth = sourceWidth;
    *targetHeight = sourceHeight;

    if (options->width && options->height) {
        *targetWidth = options->width;
        *targetHeight = options->height;
    } else if (options->width) {
        *targetWidth = options->width;
        *targetHeight = scaleDimension(sourceHeight, options->width, sourceWidth);
    } else if (options->height) {
        *targetWidth = scaleDimension(sourceWidth, options->height, sourceHeight);
        *targetHeight = options->height;
    } else {
        if (options->maxWidth && *targetWidth > options->maxWidth) {
            *targetHeight = scaleDimension(*targetHeight, options->maxWidth, *targetWidth);
            *targetWidth = options->maxWidth;
        }
        if (options->maxHeight && *targetHeight > options->maxHeight) {
            *targetWidth = scaleDimension(*targetWidth, options->maxHeight, *targetHeight);
            *targetHeight = options->maxHeight;
        }
    }

    const uint64_t pixels = (uint64_t)(*targetWidth) * (*targetHeight);
    if (*targetWidth == 0 || *targetHeight == 0 || pixels > AVIF_DEFAULT_IMAGE_SIZE_LIMIT) {
        fprintf(stderr, "Target size %u x %u exceeds libavif's default image limits.\n", *targetWidth, *targetHeight);
        return AVIF_FALSE;
    }
    return AVIF_TRUE;
}

static avifResult scaleImage(avifImage * image, uint32_t width, uint32_t height, const char * label)
{
    if (image->width == width && image->height == height) {
        return AVIF_RESULT_OK;
    }
    avifDiagnostics diag;
    memset(&diag, 0, sizeof(diag));
    const avifResult result = avifImageScale(image, width, height, &diag);
    if (result != AVIF_RESULT_OK) {
        fprintf(stderr, "Failed to scale %s to %u x %u: %s (%s)\n", label, width, height, avifResultToString(result), diag.error);
    }
    return result;
}

static avifBool writeFile(const char * path, const avifRWData * data)
{
    FILE * file = fopen(path, "wb");
    if (!file) {
        fprintf(stderr, "Failed to open %s for writing.\n", path);
        return AVIF_FALSE;
    }
    const size_t written = fwrite(data->data, 1, data->size, file);
    const int closeResult = fclose(file);
    if (written != data->size || closeResult != 0) {
        fprintf(stderr, "Failed to write %s.\n", path);
        return AVIF_FALSE;
    }
    return AVIF_TRUE;
}

int main(int argc, char ** argv)
{
    ResizeOptions options;
    memset(&options, 0, sizeof(options));
    if (!parseArgs(argc, argv, &options)) {
        return 1;
    }

    avifImage * image = avifImageCreateEmpty();
    avifDecoder * decoder = avifDecoderCreate();
    avifEncoder * encoder = NULL;
    avifRWData encoded = AVIF_DATA_EMPTY;
    int exitCode = 1;

    if (!image || !decoder) {
        fprintf(stderr, "Out of memory.\n");
        goto cleanup;
    }

    decoder->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL;
    if (options.jobs > 0) {
        decoder->maxThreads = options.jobs;
    }

    avifResult result = avifDecoderReadFile(decoder, image, options.input);
    if (result != AVIF_RESULT_OK) {
        fprintf(stderr, "Failed to decode %s: %s (%s)\n", options.input, avifResultToString(result), decoder->diag.error);
        goto cleanup;
    }
    if (!image->gainMap || !image->gainMap->image) {
        fprintf(stderr, "Input AVIF does not contain a decoded gain map.\n");
        goto cleanup;
    }

    const uint32_t sourceWidth = image->width;
    const uint32_t sourceHeight = image->height;
    const uint32_t sourceGainMapWidth = image->gainMap->image->width;
    const uint32_t sourceGainMapHeight = image->gainMap->image->height;
    uint32_t targetWidth = 0;
    uint32_t targetHeight = 0;

    if (!computeTargetSize(&options, sourceWidth, sourceHeight, &targetWidth, &targetHeight)) {
        goto cleanup;
    }

    result = scaleImage(image, targetWidth, targetHeight, "base image");
    if (result != AVIF_RESULT_OK) {
        goto cleanup;
    }

    const uint32_t targetGainMapWidth = scaleDimension(sourceGainMapWidth, targetWidth, sourceWidth);
    const uint32_t targetGainMapHeight = scaleDimension(sourceGainMapHeight, targetHeight, sourceHeight);
    result = scaleImage(image->gainMap->image, targetGainMapWidth, targetGainMapHeight, "gain map image");
    if (result != AVIF_RESULT_OK) {
        goto cleanup;
    }

    encoder = avifEncoderCreate();
    if (!encoder) {
        fprintf(stderr, "Out of memory.\n");
        goto cleanup;
    }
    encoder->quality = options.quality;
    encoder->qualityAlpha = options.qualityAlpha;
    encoder->qualityGainMap = options.qualityGainMap;
    encoder->speed = options.speed;
    encoder->autoTiling = AVIF_TRUE;
    if (options.jobs > 0) {
        encoder->maxThreads = options.jobs;
    }

    result = avifEncoderWrite(encoder, image, &encoded);
    if (result != AVIF_RESULT_OK) {
        fprintf(stderr, "Failed to encode %s: %s (%s)\n", options.output, avifResultToString(result), encoder->diag.error);
        goto cleanup;
    }
    if (!writeFile(options.output, &encoded)) {
        goto cleanup;
    }

    exitCode = 0;

cleanup:
    avifRWDataFree(&encoded);
    if (encoder) {
        avifEncoderDestroy(encoder);
    }
    if (decoder) {
        avifDecoderDestroy(decoder);
    }
    if (image) {
        avifImageDestroy(image);
    }
    return exitCode;
}
