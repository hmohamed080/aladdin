/** The Engineer settings tabs, shared by the tabbed page and by the sub-pages that keep the same frame. */
export const SETTINGS_SECTION_IDS = ["account", "security", "notifications"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function settingsSectionTitle(id: SettingsSectionId, ar: boolean): string {
  switch (id) {
    case "account": return ar ? "إعدادات الحساب" : "Account settings";
    case "security": return ar ? "الخصوصية والأمان" : "Privacy & security";
    case "notifications": return ar ? "الإشعارات" : "Notifications";
  }
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

/**
 * Runs inline, right after the tabs are in the HTML and before the first paint:
 * shows the section named in the URL hash (`#settings-security`) instead of the
 * server-rendered first tab, so a refresh or a Back never flashes the Account
 * tab while the page is still hydrating. `SettingsTabs` then takes over from
 * the same hash. An unknown hash leaves the server markup untouched.
 */
export const SETTINGS_PRESELECT_SCRIPT = `(function(){try{var m=location.hash.match(/^#settings-([a-z]+)$/);var s=document.currentScript;var root=s&&s.previousElementSibling;if(!m||!root)return;var p=root.querySelector('[role=tabpanel]#settings-'+m[1]);if(!p)return;root.querySelectorAll('[role=tabpanel]').forEach(function(e){e.hidden=e!==p});root.querySelectorAll('[role=tab]').forEach(function(t){var on=t.getAttribute('aria-controls')===p.id;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1})}catch(e){}})();`;
