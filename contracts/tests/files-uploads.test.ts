import { describe, expect, it } from 'vitest';

import { uploadAuthorizationResponse, uploadFinalizeResponse } from '../src/files/uploads';

const fileId = '00000000-0000-4000-8000-000000000001';

describe('private file upload contracts', () => {
  it('accepts a provider-neutral signed upload authorization with opaque required headers', () => {
    const response = uploadAuthorizationResponse.parse({
      file_id: fileId,
      upload_url: 'https://uploads.example.test/synthetic',
      upload_method: 'PUT',
      required_headers: {
        'Content-Type': 'image/png',
        'If-None-Match': '*',
      },
      expires_at: '2026-09-29T00:00:00.000Z',
    });

    expect(response).toEqual({
      file_id: fileId,
      upload_url: 'https://uploads.example.test/synthetic',
      upload_method: 'PUT',
      required_headers: {
        'Content-Type': 'image/png',
        'If-None-Match': '*',
      },
      expires_at: '2026-09-29T00:00:00.000Z',
    });
  });

  it('strips provider metadata from the accepted-file response shape', () => {
    const response = uploadFinalizeResponse.parse({
      file: {
        file_id: fileId,
        purpose: 'catalogue_image',
        lifecycle_status: 'accepted',
        content_type: 'image/png',
        byte_size: 512,
        sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        frozen_at: '2026-09-29T00:00:00.000Z',
        version_id: 'provider-private-version',
      },
    });

    expect(response.file).toEqual({
      file_id: fileId,
      purpose: 'catalogue_image',
      lifecycle_status: 'accepted',
      content_type: 'image/png',
      byte_size: 512,
      sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      frozen_at: '2026-09-29T00:00:00.000Z',
    });
  });
});
