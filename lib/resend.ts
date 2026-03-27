import { Resend } from "resend";

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("Falta RESEND_API_KEY.");
  }

  return new Resend(apiKey);
}
