import { Readable } from 'node:stream';

import type { NextFunction, Request, Response } from 'express';

import { DependencyUnavailableError } from '../../shared/errors.js';

export interface FileStreamResponse {
  body: AsyncIterable<Uint8Array>;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'application/zip';
  byteSize: number;
}

/** Sets safe response metadata and pipes object bytes without buffering them in API memory. */
export function streamFileResponse(
  _req: Request,
  res: Response,
  next: NextFunction,
  file: FileStreamResponse,
  cacheControl: string,
  downloadFileName?: string,
): void {
  res.status(200);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.byteSize));
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    downloadFileName
      ? `attachment; filename="${downloadFileName.replace(/["\\\r\n]/g, '_')}"`
      : file.mimeType === 'application/pdf' || file.mimeType === 'application/zip' ? 'attachment' : 'inline',
  );
  res.setHeader('Referrer-Policy', 'no-referrer');

  const stream = Readable.from(file.body);
  stream.on('error', () => {
    if (res.headersSent) res.destroy(new Error('File stream failed.'));
    else next(new DependencyUnavailableError('The requested file is temporarily unavailable.'));
  });
  stream.pipe(res);
}
