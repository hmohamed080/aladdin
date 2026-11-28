"use client";

import type { MyIdentity } from "@/server/queries/profile-identity";
import { AvatarField } from "@/features/settings/avatar-field";
import { CoverField } from "@/features/settings/cover-field";

/**
 * Step 1 header of the engineer profile completion: the cover banner with the
 * profile photo overlapping its lower edge. Both fields keep their own
 * pending -> ready upload flows; this only composes them.
 */
export function EngineerProfileHero({ identity }: { identity: MyIdentity }) {
  return (
    <div className="engineer-basics-hero">
      <CoverField coverUrl={identity.coverUrl} />
      <div className="engineer-basics-avatar-slot">
        <AvatarField avatarUrl={identity.avatarUrl} displayName={identity.displayName} variant="hero" />
      </div>
    </div>
  );
}
