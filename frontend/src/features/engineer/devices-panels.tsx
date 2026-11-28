import type { MyDevice, MySession } from "@/server/queries/account-devices";
import { forgetDeviceAction, revokeSessionAction, signOutOtherSessionsAction } from "@/server/actions/account-devices";
import { deviceLabel, maskIp } from "@/lib/ui/user-agent";
import { relativeTime } from "@/lib/ui/relative-time";

type Locale = "ar" | "en";

const copy = (ar: boolean) => ({
  on: ar ? "على" : "on",
  unknown: ar ? "جهاز غير معروف" : "Unknown device",
  thisDevice: ar ? "هذا الجهاز" : "This device",
});

/** Active sessions: every live sign-in of this account, with a way to end the others. */
export function SessionsPanel({ sessions, locale }: { sessions: MySession[]; locale: Locale }) {
  const ar = locale === "ar";
  const c = copy(ar);
  if (sessions.length === 0) return <p>{ar ? "لا توجد جلسات نشطة لعرضها." : "There are no active sessions to show."}</p>;
  const others = sessions.filter((s) => !s.isCurrent);
  return (
    <div className="engineer-devices">
      {sessions.map((s) => {
        const ip = maskIp(s.ip);
        return (
          <div className="engineer-method-row" key={s.id}>
            <span>
              <strong>
                {deviceLabel(s.userAgent, c.on, c.unknown)}
                {s.isCurrent ? <em className="engineer-badge">{c.thisDevice}</em> : null}
              </strong>
              <small>
                {s.isCurrent ? (ar ? "نشطة الآن" : "Active now") : `${ar ? "آخر نشاط" : "Last active"} ${relativeTime(s.lastActiveAt, locale)}`}
                {ip ? <> · <bdi dir="ltr">{ip}</bdi></> : null}
              </small>
            </span>
            {s.isCurrent ? null : (
              <form action={revokeSessionAction}>
                <input type="hidden" name="sessionId" value={s.id} />
                <button type="submit">{ar ? "تسجيل الخروج" : "Sign out"}</button>
              </form>
            )}
          </div>
        );
      })}
      {others.length > 0 ? (
        <form action={signOutOtherSessionsAction} className="engineer-devices-all">
          <button type="submit">{ar ? "تسجيل الخروج من كل الجلسات الأخرى" : "Sign out of all other sessions"}</button>
        </form>
      ) : null}
    </div>
  );
}

/** Trusted devices: every browser that has signed in to this account; removing one also ends its session. */
export function DevicesPanel({ devices, locale }: { devices: MyDevice[]; locale: Locale }) {
  const ar = locale === "ar";
  const c = copy(ar);
  if (devices.length === 0) return <p>{ar ? "ستظهر هنا الأجهزة التي تسجّل الدخول إلى حسابك." : "Devices that sign in to your account will appear here."}</p>;
  return (
    <div className="engineer-devices">
      {devices.map((d) => (
        <div className="engineer-method-row" key={d.deviceId}>
          <span>
            <strong>
              {deviceLabel(d.userAgent, c.on, c.unknown)}
              {d.isCurrent ? <em className="engineer-badge">{c.thisDevice}</em> : null}
            </strong>
            <small>
              {d.isCurrent ? (ar ? "نشط الآن" : "Active now") : `${ar ? "آخر ظهور" : "Last seen"} ${relativeTime(d.lastSeenAt, locale)}`}
              {" · "}
              {ar ? "أول ظهور" : "First seen"} {relativeTime(d.firstSeenAt, locale)}
            </small>
          </span>
          {d.isCurrent ? null : (
            <form action={forgetDeviceAction}>
              <input type="hidden" name="deviceId" value={d.deviceId} />
              <button type="submit">{ar ? "إزالة" : "Remove"}</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
