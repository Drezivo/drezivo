type StaffSiteEnvironment = {
  NEXT_PUBLIC_PARTNERS_URL?: string | undefined;
  VERCEL_ENV?: string | undefined;
  VERCEL_GIT_COMMIT_REF?: string | undefined;
  VERCEL_URL?: string | undefined;
  NODE_ENV?: string | undefined;
};

/** Resolve the public origin used to construct staff-app social metadata. */
export function resolveStaffSiteOrigin(env: StaffSiteEnvironment): string {
  if (env["NEXT_PUBLIC_PARTNERS_URL"]) return env["NEXT_PUBLIC_PARTNERS_URL"];
  if (env["VERCEL_ENV"] === "preview") {
    if (env["VERCEL_GIT_COMMIT_REF"] === "staging") return "https://app-preview.drezivo.shop";
    if (env["VERCEL_URL"]) return `https://${env["VERCEL_URL"]}`;
  }
  return env["NODE_ENV"] === "production" ? "https://partners.drezivo.shop" : "http://localhost:3000";
}
