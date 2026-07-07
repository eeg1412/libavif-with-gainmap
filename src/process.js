'use strict';

const { spawn } = require('node:child_process');

class AvifGainMapError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'AvifGainMapError';
    this.command = detail.command;
    this.args = detail.args;
    this.exitCode = detail.exitCode;
    this.signal = detail.signal;
    this.stdout = detail.stdout || '';
    this.stderr = detail.stderr || '';
    if (detail.cause) {
      this.cause = detail.cause;
    }
  }
}

const WINDOWS_STATUS_DLL_NOT_FOUND = 0xc0000135;

function isWindowsDllNotFound(exitCode) {
  return exitCode === WINDOWS_STATUS_DLL_NOT_FOUND || exitCode === -1073741515;
}

function formatExitMessage(command, exitCode) {
  let message = `${command} exited with code ${exitCode}.`;
  if (process.platform === 'win32' && isWindowsDllNotFound(exitCode)) {
    message +=
      ' Windows status 0xC0000135 means the native executable could not start because a required DLL was not found. ' +
      'Upgrade libavif-with-gainmap or reinstall a package version whose Windows binaries are built with MSVC.';
  }
  return message;
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.verbose) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.verbose) {
        process.stderr.write(chunk);
      }
    });

    child.on('error', (cause) => {
      reject(
        new AvifGainMapError(`Failed to start ${command}: ${cause.message}`, {
          args,
          cause,
          command,
          stderr,
          stdout
        })
      );
    });

    child.on('close', (exitCode, signal) => {
      const result = { args, command, exitCode, signal, stderr, stdout };
      if (exitCode === 0) {
        resolve(result);
        return;
      }
      reject(
        new AvifGainMapError(formatExitMessage(command, exitCode), {
          ...result
        })
      );
    });
  });
}

module.exports = {
  AvifGainMapError,
  runFile
};
