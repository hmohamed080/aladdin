/**
 * The approved Aladdin palette as literal values, for HTML EMAIL ONLY: mail clients cannot read the CSS tokens
 * (src/styles/tokens.css), so a message needs the colours themselves. These are exactly the four approved brand colours;
 * nothing else may be added here.
 */
export const EMAIL_BRAND = {
  sand: "#D8C7A6",
  terracotta: "#B96F52",
  cream: "#F2E9D8",
  navy: "#071A2D",
} as const;
