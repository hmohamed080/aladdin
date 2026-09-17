export const ACTIVITY_EVENT_TYPES = [
  "rfq.created",
  "rfq.submitted",
  "rfq.updated",
  "rfq.cancelled",
  "rfq.closed",
  "quotation.created",
  "quotation.submitted",
  "quotation.updated",
  "quotation.accepted",
  "quotation.rejected",
  "order.created",
  "order.started",
  "order.completed",
  "order.cancelled",
  "project.created",
  "project.activated",
  "project.completed",
  "lead.created",
  "lead.details_changed",
  "customer.created",
  "customer.updated",
  "customer.reassigned",
  "followup.created",
  "followup.completed",
  "followup.reopened",
  "followup.reassigned",
  "affiliation.requested",
  "affiliation.approved",
  "affiliation.rejected",
  "affiliation.cancelled",
  "product.created",
  "product.updated",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];
export type ActivityEventFamily = ActivityEventType extends `${infer Family}.${string}`
  ? Family
  : never;

export const ACTIVITY_EVENT_FAMILIES = Array.from(
  new Set(ACTIVITY_EVENT_TYPES.map((eventType) => eventType.split(".")[0] as ActivityEventFamily)),
);

export type ActivityFilters = {
  family?: ActivityEventFamily;
  from?: string;
  to?: string;
};

export type ActivityFilterInput = {
  family?: string;
  from?: string;
  to?: string;
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(value: string | undefined): string | undefined {
  if (!value || value.length !== 10) return undefined;

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;

  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? value : undefined;
}

export function normalizeActivityFilters(input: ActivityFilterInput = {}): ActivityFilters {
  const family = ACTIVITY_EVENT_FAMILIES.find((candidate) => candidate === input.family);
  const from = validIsoDate(input.from);
  const to = validIsoDate(input.to);

  return {
    ...(family ? { family } : {}),
    ...(from && (!to || from <= to) ? { from } : {}),
    ...(to && (!from || from <= to) ? { to } : {}),
  };
}

export function dayAfter(date: string): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}
