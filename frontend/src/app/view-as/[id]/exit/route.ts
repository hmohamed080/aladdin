// The exact tree's Exit is the SAME audited handler as the interim view's (it ends the caller's own session and returns to
// the user's admin page); mirrored here so `/view-as/[id]/exit` works and the view never needs a link into `/admin/.../view`.
export { POST } from "@/app/admin/users/[id]/view/exit/route";

export const dynamic = "force-dynamic";
