export interface UploadAuthorization {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
}

export interface UploadedObjectMetadata {
  contentType: string;
  byteSize: number;
  sha256: string | null;
  versionId: string | null;
  prefix: Uint8Array;
}

export interface ReadAuthorization {
  readUrl: string;
  expiresAt: Date;
}

export interface ObjectStorage {
  authorizeUpload(input: {
    storageKey: string;
    contentType: string;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<UploadAuthorization>;
  authorizeRead(input: {
    storageKey: string;
    versionId?: string | null;
    expiresInSeconds: number;
  }): Promise<ReadAuthorization>;
  inspectUploadedObject(storageKey: string): Promise<UploadedObjectMetadata | null>;
}
