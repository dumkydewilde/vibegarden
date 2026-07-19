import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import Login from "../login";

function renderLogin(
  action: ({ request }: { request: Request }) => unknown,
  next = "/",
) {
  const Stub = createRoutesStub([
    {
      path: "/login",
      Component: Login,
      loader: () => ({ google: false, next }),
      action,
    },
  ]);
  render(<Stub initialEntries={["/login"]} />);
}

describe("Login OTP entry", () => {
  it("uses invite-link guidance when sign-in will return to a club invitation", async () => {
    renderLogin(() => null, `/join/${"a".repeat(43)}`);

    expect(
      await screen.findByText("Sign in to continue with this club invitation."),
    ).toBeInTheDocument();
  });

  it("starts empty and submits a six-digit code", async () => {
    let submittedCode: string | undefined;
    renderLogin(async ({ request }) => {
      const form = await request.formData();
      if (form.get("intent") === "request") {
        return { step: "code", email: "alice@example.com" };
      }
      submittedCode = String(form.get("code"));
      return {
        step: "code",
        email: "alice@example.com",
        error: "That code is not right. Check your email and try again.",
      };
    });

    fireEvent.change(await screen.findByPlaceholderText("you@example.com"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me a code/i }));

    const code = await screen.findByLabelText("Verification code");
    expect(code).toHaveValue("");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(document.querySelectorAll('[data-slot="input-otp-slot"]')).toHaveLength(6);

    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/that code is not right/i)).toBeInTheDocument();
    expect(submittedCode).toBe("123456");
    // input-otp schedules uncancelled setup updates through 50 ms. Let them
    // settle while jsdom is still installed so Vitest cannot tear down the
    // window before the library dispatches its final update.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
