import type { ReactNode } from "react";
import { ForgetAccountCart } from "@/features/marketplace/live/cart-viewer";

/** Sign-out lands here: a Marketplace cart that mirrored the signed-out account is dropped from this browser. */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ForgetAccountCart />
      {children}
    </>
  );
}
