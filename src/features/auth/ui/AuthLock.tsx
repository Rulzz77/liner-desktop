import { useLayoutEffect } from "react";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { setAuthSession } from "@/shared/api";
import { useAuthStore } from "../store/authStore";

export function AuthLock({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    // This build does not use Liner accounts. Clear any old Liner session before
    // child effects can start account-only requests. YouTube authorization is
    // stored independently and is left untouched.
    setAuthSession(null);
    useAuthStore.setState({ status: "anonymous", user: null });
  }, []);

  return <AppFrame>{children}</AppFrame>;
}

export default AuthLock;
