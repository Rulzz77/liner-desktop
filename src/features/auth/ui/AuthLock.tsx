import { useEffect } from "react";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { setAuthSession } from "@/shared/api";
import { useAuthStore } from "../store/authStore";

export function AuthLock({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // This build does not use Liner accounts. Clear any old Liner session so
    // account credentials/tokens are not sent silently by background requests.
    // YouTube's separate device authorization is stored independently.
    setAuthSession(null);
    useAuthStore.setState({ status: "anonymous", user: null });
  }, []);

  return <AppFrame>{children}</AppFrame>;
}

export default AuthLock;
