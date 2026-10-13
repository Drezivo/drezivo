import { auth } from "@clerk/nextjs/server";

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function failure(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> }
): Promise<Response> {
  const { fileId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return failure(404);

  const branchId = new URL(request.url).searchParams.get("branch_id");
  if (branchId !== null && !/^[0-9a-f-]{36}$/i.test(branchId)) return failure(404);

  const configured = process.env["NEXT_PUBLIC_API_ORIGIN"];
  if (!configured) return failure(503);
  let origin: string;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return failure(503);
    origin = url.origin;
  } catch {
    return failure(503);
  }

  let token: string | null;
  try {
    const session = await auth();
    token = await session.getToken();
  } catch {
    return failure(401);
  }
  if (!token) return failure(401);

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/api/v1/media/staff/${encodeURIComponent(fileId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "image/avif,image/webp,image/png,image/jpeg,application/pdf",
        ...(branchId ? { "X-Drezivo-Branch-Id": branchId } : {}),
      },
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return failure(503);
  }
  if (!upstream.ok || !upstream.body)
    return failure(upstream.status >= 400 ? upstream.status : 502);

  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !MEDIA_TYPES.has(contentType)) return failure(502);

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) headers.set("Content-Length", contentLength);
  const disposition = upstream.headers.get("content-disposition");
  if (disposition === "inline" || disposition === "attachment")
    headers.set("Content-Disposition", disposition);
  return new Response(upstream.body, { status: 200, headers });
}
