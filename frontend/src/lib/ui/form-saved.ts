/** A form announcing that its save SUCCEEDED, with the values it sent. `requestSubmit()` reports nothing back. */
export const FORM_SAVED_EVENT = "aladdin:form-saved";

export type FormSavedDetail = { id: string; data: FormData };

export function announceFormSaved(id: string, data: FormData) {
  window.dispatchEvent(new CustomEvent<FormSavedDetail>(FORM_SAVED_EVENT, { detail: { id, data } }));
}
