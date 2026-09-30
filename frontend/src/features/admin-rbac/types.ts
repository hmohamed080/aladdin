import type { getMessages } from "@/lib/i18n/translate";

export type Messages = ReturnType<typeof getMessages>;
export type StaffMessages = Messages["admin"]["preview"]["staff"];
