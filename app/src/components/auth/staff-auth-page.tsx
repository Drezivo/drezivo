import Link from "next/link";

import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { StaffSignInForm } from "@/components/auth/staff-sign-in-form";

type StaffAuthPageProps = {
  mode?: "sign-in" | "sign-up";
};

export function StaffAuthPage({ mode = "sign-in" }: StaffAuthPageProps) {
  const isSignUp = mode === "sign-up";

  return (
    <AuthSplitLayout panelAriaLabel="Drezivo staff authentication">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12 sm:py-16">
        <div className="mb-8 text-center">
          <div className="mb-6">
            <AuthBrand />
          </div>

          <h1
            id="staff-auth-heading"
            className="font-display text-3xl leading-tight text-auth-text sm:text-4xl"
          >
            {isSignUp ? "Create your professional account" : "Drezivo for professionals"}
          </h1>
          <p className="mt-3 text-sm text-auth-dark-muted sm:text-base">
            {isSignUp
              ? "Set up your account to manage your business."
              : "Sign in to manage your business."}
          </p>
        </div>

        <StaffSignInForm initialFlow={mode} />

        <p className="mt-8 text-center text-sm text-auth-dark-muted">
          {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="font-medium text-auth-link underline-offset-4 hover:underline"
          >
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
