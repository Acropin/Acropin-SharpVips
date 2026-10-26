/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class ImageValidationError extends Error {
  public code: string;
  public details?: Record<string, unknown>;

  constructor(message: string, code = 'IMAGE_VALIDATION_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
    this.details = details;
  }
}

export class ImageTooSmallError extends ImageValidationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'IMAGE_TOO_SMALL_FOR_UPSCALE', details);
    this.name = 'ImageTooSmallError';
  }
}

export class ImageProcessingError extends Error {
  public code: string;

  constructor(message: string, code = 'IMAGE_PROCESSING_FAILED') {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

export class StorageError extends Error {
  public code: string;

  constructor(message: string, code = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}
