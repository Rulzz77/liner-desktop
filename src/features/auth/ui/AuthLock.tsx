import { useEffect } from "react";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { setAuthSession } from "@/shared/api";
import { useAuthStore } from "../store/authStore";

export function AuthLock({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // This build runs as a local-first desktop player. Clear only the Liner
    // account session; YouTube's separate device authorization is unaffected.
    setAuthSession(null);
    useAuthStore.setState({ status: "anonymous", user: null });
  }, []);

  return <AppFrame>{children}</AppFrame>;
}

export default AuthLock;
