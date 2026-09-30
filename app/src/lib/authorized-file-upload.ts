import type { UploadAuthorizationResponse } from "@drezivo/contracts";

/**
 * PUT bytes using the API's exact signed request shape. A 412 is safe to finalize: create-only
 * storage returns it when this unique upload key already exists, and the API still verifies the
 * stored size, type, SHA-256, and magic bytes before accepting the file.
 */
export async function uploadAuthorizedFile(
  authorization: UploadAuthorizationResponse,
  file: Blob,
  failureMessage: string
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(authorization.upload_url, {
      method: authorization.upload_method,
      headers: authorization.required_headers,
      body: file,
    });
  } catch {
    throw new Error(failureMessage);
  }

  if (!response.ok && response.status !== 412) throw new Error(failureMessage);
}
