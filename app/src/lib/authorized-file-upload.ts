import type { UploadAuthorizationResponse } from "@drezivo/contracts";

/** Upload directly to the configured object store using the API's exact signed request shape. */
export async function uploadAuthorizedFile(
  authorization: UploadAuthorizationResponse,
  file: Blob,
  failureMessage: string
): Promise<void> {
  const response = await fetch(authorization.upload_url, {
    method: authorization.upload_method,
    headers: authorization.required_headers,
    body: file,
  });

  if (!response.ok) throw new Error(failureMessage);
}
