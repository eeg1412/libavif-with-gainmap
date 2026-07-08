// Package-specific probe helper built next to libavif.
// It reuses libavif's JPEG gain map reader and stops after parsing the input.
// No AVIF is encoded, so this is a strict detection path without conversion work.

#include "avif/avif.h"
#include "avifutil.h"
#include "imageio.h"

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>

#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

namespace {

int dupStdout()
{
    std::fflush(stdout);
#if defined(_WIN32)
    return _dup(_fileno(stdout));
#else
    return dup(fileno(stdout));
#endif
}

void restoreStdout(int saved)
{
    if (saved < 0) {
        return;
    }
    std::fflush(stdout);
#if defined(_WIN32)
    _dup2(saved, _fileno(stdout));
    _close(saved);
#else
    dup2(saved, fileno(stdout));
    close(saved);
#endif
    clearerr(stdout);
    std::cout.clear();
}

int silenceStdout()
{
    const int saved = dupStdout();
    if (saved < 0) {
        return saved;
    }
#if defined(_WIN32)
    FILE * ignored = nullptr;
    freopen_s(&ignored, "NUL", "w", stdout);
#else
    FILE * ignored = freopen("/dev/null", "w", stdout);
#endif
    if (ignored == nullptr) {
        restoreStdout(saved);
        return -1;
    }
    return saved;
}

template <typename Fraction>
double fractionToDouble(const Fraction & fraction)
{
    return fraction.d != 0 ? static_cast<double>(fraction.n) / fraction.d : 0.0;
}

void printUsage()
{
    std::cerr << "Usage: avifgainmapprobe <input.jpg> [--jobs N]\n";
}

} // namespace

int main(int argc, char ** argv)
{
#if !defined(AVIF_ENABLE_JPEG_GAIN_MAP_CONVERSION)
    std::cerr << "JPEG gain map probing unavailable because libavif was not built with libxml2.\n";
    return 3;
#else
    std::string input;
    int jobs = 1;

    for (int i = 1; i < argc; ++i) {
        const std::string arg(argv[i]);
        if (arg == "--help" || arg == "-h") {
            printUsage();
            return 0;
        }
        if (arg == "--jobs") {
            if (i + 1 >= argc) {
                std::cerr << "--jobs requires a value.\n";
                return 1;
            }
            jobs = std::atoi(argv[++i]);
            if (jobs < 1) {
                std::cerr << "--jobs must be a positive integer.\n";
                return 1;
            }
            continue;
        }
        if (!input.empty()) {
            std::cerr << "Only one input path is supported.\n";
            return 1;
        }
        input = arg;
    }

    if (input.empty()) {
        printUsage();
        return 1;
    }

    if (avifGuessFileFormat(input.c_str()) != AVIF_APP_FILE_FORMAT_JPEG) {
        std::cerr << "Input is not a JPEG file: " << input << "\n";
        return 1;
    }

    avifImage * image = avifImageCreateEmpty();
    if (image == nullptr) {
        std::cerr << "Out of memory.\n";
        return 1;
    }

    const int savedStdout = silenceStdout();
    const avifResult result = avif::ReadImage(image,
                                              input,
                                              AVIF_PIXEL_FORMAT_NONE,
                                              0,
                                              /*ignore_profile=*/false,
                                              /*ignore_gain_map=*/false,
                                              jobs);
    restoreStdout(savedStdout);

    if (result != AVIF_RESULT_OK) {
        std::cerr << "Failed to decode JPEG: " << input << ": " << avifResultToString(result) << "\n";
        avifImageDestroy(image);
        return 1;
    }

    const avifGainMap * gainMap = image->gainMap;
    const bool hasGainMap = gainMap != nullptr && gainMap->image != nullptr;

    std::cout << "{";
    std::cout << "\"hasGainMap\":" << (hasGainMap ? "true" : "false");
    std::cout << ",\"width\":" << image->width;
    std::cout << ",\"height\":" << image->height;
    if (hasGainMap) {
        std::cout << ",\"gainMap\":{";
        std::cout << "\"width\":" << gainMap->image->width;
        std::cout << ",\"height\":" << gainMap->image->height;
        std::cout << ",\"baseHeadroom\":" << fractionToDouble(gainMap->baseHdrHeadroom);
        std::cout << ",\"alternateHeadroom\":" << fractionToDouble(gainMap->alternateHdrHeadroom);
        std::cout << "}";
    }
    std::cout << "}\n";

    avifImageDestroy(image);
    return 0;
#endif
}
