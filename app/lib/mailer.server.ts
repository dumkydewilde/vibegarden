/**
 * Sends the OTP email via Resend when configured. Returns false when no mail
 * provider is set up; callers then surface the code another way (dev flow).
 */
export async function sendOtpEmail(env: Env, email: string, code: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[vibe-garden] Login code for ${email}: ${code}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? "Vibe Garden <onboarding@resend.dev>",
      to: [email],
      subject: `${code} is your Vibe Garden code`,
      text: `Your Vibe Garden login code is ${code}. It works for 10 minutes.\n\nSee you in the garden!`,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    return false;
  }
  return true;
}
