import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffSignInForm } from "@/components/auth/staff-sign-in-form";

const clerk = vi.hoisted(() => ({
  useSignIn: vi.fn(),
  useSignUp: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useSignIn: clerk.useSignIn,
  useSignUp: clerk.useSignUp,
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "errors" in error),
}));

function createSignInMock() {
  const signIn = {
    status: "needs_first_factor",
    createdSessionId: null,
    supportedFirstFactors: [
      {
        strategy: "email_code",
        emailAddressId: "email_123",
        safeIdentifier: "s•••@example.com",
      },
    ],
    supportedSecondFactors: [],
    create: vi.fn(),
    prepareFirstFactor: vi.fn(),
    attemptFirstFactor: vi.fn(),
    prepareSecondFactor: vi.fn(),
    attemptSecondFactor: vi.fn(),
    authenticateWithRedirect: vi.fn(),
  };

  signIn.create.mockResolvedValue(signIn);
  signIn.prepareFirstFactor.mockResolvedValue(signIn);
  signIn.attemptFirstFactor.mockResolvedValue({
    ...signIn,
    status: "complete",
    createdSessionId: "session_123",
  });
  signIn.prepareSecondFactor.mockResolvedValue(signIn);
  signIn.attemptSecondFactor.mockResolvedValue({
    ...signIn,
    status: "complete",
    createdSessionId: "session_123",
  });
  signIn.authenticateWithRedirect.mockResolvedValue(undefined);

  return signIn;
}

function createSignUpMock() {
  const signUp = {
    status: "missing_requirements",
    createdSessionId: null,
    create: vi.fn(),
    prepareEmailAddressVerification: vi.fn(),
    attemptEmailAddressVerification: vi.fn(),
    authenticateWithRedirect: vi.fn(),
  };

  signUp.create.mockResolvedValue(signUp);
  signUp.prepareEmailAddressVerification.mockResolvedValue(signUp);
  signUp.attemptEmailAddressVerification.mockResolvedValue({
    ...signUp,
    status: "complete",
    createdSessionId: "session_signup",
  });
  signUp.authenticateWithRedirect.mockResolvedValue(undefined);

  return signUp;
}

function useClerkMocks(signIn = createSignInMock(), signUp = createSignUpMock()) {
  clerk.useSignIn.mockReturnValue({ isLoaded: true, signIn, setActive: clerk.setActive });
  clerk.useSignUp.mockReturnValue({ isLoaded: true, signUp, setActive: clerk.setActive });
  return { signIn, signUp };
}

function submitCurrentForm() {
  const form = screen.getByTestId("staff-sign-in-form").querySelector("form");
  if (!form) throw new Error("Expected a sign-in form");
  fireEvent.submit(form);
}

describe("StaffSignInForm", () => {
  beforeEach(() => {
    clerk.setActive.mockReset().mockResolvedValue(undefined);
    clerk.useSignIn.mockReset();
    clerk.useSignUp.mockReset();
  });

  it("starts email verification with the configured email factor", async () => {
    const { signIn } = useClerkMocks();
    render(<StaffSignInForm />);

    expect(document.getElementById("clerk-captcha")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
    submitCurrentForm();

    await waitFor(() =>
      expect(signIn.create).toHaveBeenCalledWith({ identifier: "staff@example.com" })
    );
    expect(signIn.prepareFirstFactor).toHaveBeenCalledWith({
      strategy: "email_code",
      emailAddressId: "email_123",
    });
    expect(screen.getByLabelText("Verification code")).toBeVisible();
  });

  it("starts email sign-up when Clerk cannot find the account", async () => {
    const { signIn, signUp } = useClerkMocks();
    signIn.create.mockRejectedValue({
      errors: [{ code: "form_identifier_not_found" }],
    });
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new-owner@example.com" },
    });
    submitCurrentForm();

    await waitFor(() =>
      expect(signUp.create).toHaveBeenCalledWith({ emailAddress: "new-owner@example.com" })
    );
    expect(signUp.prepareEmailAddressVerification).toHaveBeenCalledWith({ strategy: "email_code" });
    expect(screen.getByLabelText("Verification code")).toBeVisible();
  });

  it("verifies a new account and activates only the completed sign-up session", async () => {
    const { signUp } = useClerkMocks();
    render(<StaffSignInForm initialFlow="sign-up" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new-owner@example.com" },
    });
    submitCurrentForm();
    await screen.findByLabelText("Verification code");

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    submitCurrentForm();

    await waitFor(() =>
      expect(signUp.attemptEmailAddressVerification).toHaveBeenCalledWith({ code: "123456" })
    );
    expect(clerk.setActive).toHaveBeenCalledWith({
      session: "session_signup",
      redirectUrl: "/onboarding",
    });
  });

  it("shows a safe validation error for an invalid email", async () => {
    const { signIn } = useClerkMocks();
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    submitCurrentForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email address to continue."
    );
    expect(signIn.create).not.toHaveBeenCalled();
  });

  it("activates a session only after the first factor is complete", async () => {
    const { signIn } = useClerkMocks();
    signIn.attemptFirstFactor.mockResolvedValue({
      ...signIn,
      status: "needs_second_factor",
      createdSessionId: null,
      supportedSecondFactors: [{ strategy: "totp" }],
    });
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
    submitCurrentForm();
    await screen.findByLabelText("Verification code");

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    submitCurrentForm();

    await waitFor(() =>
      expect(signIn.attemptFirstFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        code: "123456",
      })
    );
    expect(clerk.setActive).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter the code from your authenticator app.")).toBeVisible();

    signIn.attemptSecondFactor.mockResolvedValue({
      ...signIn,
      status: "complete",
      createdSessionId: "session_456",
    });
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "654321" } });
    submitCurrentForm();

    await waitFor(() =>
      expect(clerk.setActive).toHaveBeenCalledWith({
        session: "session_456",
        redirectUrl: "/auth/resolve",
      })
    );
  });

  it("shows a generic error when the verification code is rejected", async () => {
    const { signIn } = useClerkMocks();
    signIn.attemptFirstFactor.mockRejectedValue(new Error("provider detail"));
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
    submitCurrentForm();
    await screen.findByLabelText("Verification code");

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "000000" } });
    submitCurrentForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't continue. Please check your details and try again."
    );
    expect(screen.queryByText("provider detail")).not.toBeInTheDocument();
  });

  it("resends the code and can restart the email flow", async () => {
    const { signIn } = useClerkMocks();
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
    submitCurrentForm();
    await screen.findByLabelText("Verification code");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(signIn.prepareFirstFactor).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeVisible();
  });

  it("resends a sign-up code and can restart the sign-up flow", async () => {
    const { signUp } = useClerkMocks();
    render(<StaffSignInForm initialFlow="sign-up" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new-owner@example.com" },
    });
    submitCurrentForm();
    await screen.findByLabelText("Verification code");

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(signUp.prepareEmailAddressVerification).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeVisible();
  });

  it("uses only the Google OAuth strategy", async () => {
    const { signIn } = useClerkMocks();
    render(<StaffSignInForm />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    });

    expect(signIn.authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/auth/resolve",
    });
  });

  it("sends Google sign-up completions to onboarding", async () => {
    const { signUp } = useClerkMocks();
    render(<StaffSignInForm initialFlow="sign-up" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    });

    expect(signUp.authenticateWithRedirect).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/onboarding",
    });
  });

  it("disables the email submit button while a request is pending", async () => {
    const { signIn } = useClerkMocks();
    let resolveCreate: (value: typeof signIn) => void = () => undefined;
    signIn.create.mockReturnValue(
      new Promise<typeof signIn>((resolve) => {
        resolveCreate = resolve;
      })
    );
    render(<StaffSignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
    submitCurrentForm();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    await act(async () => resolveCreate(signIn));
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeVisible());
  });
});
