export type QuestionnaireAnswers = {
  subscription: "chatgpt" | "claude" | "other" | "none";
  /** Euros per month they would spend; only asked when subscription is none. */
  budget: 0 | 5 | 20 | null;
  devices: ("laptop" | "phone" | "tablet")[];
  expectations: string;
};

const subscriptions = ["chatgpt", "claude", "other", "none"] as const;
const budgets = [0, 5, 20] as const;
const devices = ["laptop", "phone", "tablet"] as const;

/** Validates raw form values into a well-formed answers object, or null. */
export function parseAnswers(raw: {
  subscription?: string;
  budget?: string;
  devices?: string[];
  expectations?: string;
}): QuestionnaireAnswers | null {
  const subscription = subscriptions.find((s) => s === raw.subscription);
  if (!subscription) return null;

  let budget: QuestionnaireAnswers["budget"] = null;
  if (subscription === "none") {
    const parsed = Number(raw.budget);
    budget = budgets.find((b) => b === parsed) ?? 0;
  }

  const chosenDevices = (raw.devices ?? []).filter(
    (d): d is (typeof devices)[number] =>
      (devices as readonly string[]).includes(d),
  );
  if (chosenDevices.length === 0) return null;

  return {
    subscription,
    budget,
    devices: chosenDevices,
    expectations: (raw.expectations ?? "").trim().slice(0, 2000),
  };
}

export const subscriptionLabel: Record<
  QuestionnaireAnswers["subscription"],
  string
> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  other: "another AI subscription",
  none: "no subscription yet",
};

/** One-line summary for the admin view. */
export function summarizeAnswers(answers: QuestionnaireAnswers): string {
  const parts = [
    subscriptionLabel[answers.subscription],
    answers.budget !== null ? `would pay €${answers.budget}/mo` : null,
    answers.devices.join(" + "),
  ].filter(Boolean);
  const summary = parts.join(" · ");
  return answers.expectations
    ? `${summary} · "${answers.expectations.slice(0, 120)}"`
    : summary;
}
