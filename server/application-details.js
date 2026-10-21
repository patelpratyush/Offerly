import { z } from "zod";
import { HttpError } from "./security.js";
const optionalDate = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const timestamp = Date.parse(value);
        return (
          Number.isFinite(timestamp) &&
          new Date(timestamp).toISOString().slice(0, 10) === value
        );
      }, "Enter a valid calendar date"),
  ])
  .default("");
export const applicationDetailsShape = {
  offerOutcome: z
    .enum(["Not recorded", "Pending", "Accepted", "Declined"])
    .default("Not recorded"),
  offerReceivedDate: optionalDate,
  offerDecisionDate: optionalDate,
  descriptionCapturedDate: optionalDate,
  descriptionSourceUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .max(2048)
        .url()
        .refine((value) => {
          const parsed = new URL(value);
          return (
            ["https:", "http:"].includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password
          );
        }, "Use an HTTP or HTTPS URL without embedded credentials"),
    ])
    .default(""),
};
// Stage is intentionally independent: customizing stages must not rewrite facts.
export function validateApplicationDetails(data) {
  const decided = ["Accepted", "Declined"].includes(data.offerOutcome);
  if (decided && !data.offerDecisionDate)
    throw new HttpError(
      400,
      "Accepted or declined offers require the actual decision date",
    );
  if (!decided && data.offerDecisionDate)
    throw new HttpError(
      400,
      "Only accepted or declined offers can have a decision date",
    );
  if (
    data.offerReceivedDate &&
    data.offerDecisionDate &&
    data.offerDecisionDate < data.offerReceivedDate
  )
    throw new HttpError(
      400,
      "Offer decision date cannot precede the received date",
    );
  if (
    (data.descriptionCapturedDate || data.descriptionSourceUrl) &&
    !data.description?.trim()
  )
    throw new HttpError(
      400,
      "Listing capture details require a saved job description",
    );
  return data;
}
