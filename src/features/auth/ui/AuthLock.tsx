import { useEffect } from "react";
import AppFrame from "@/features/navigation/ui/AppFrame";
import { useAuthStore } from "../store/authStore";

export function AuthLock({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    // Authentication is optional in this local-first build. Keep an existing
    // session intact, but never block the application when no session exists.
    void initialize();
  }, [initialize]);

  return <AppFrame>{children}</AppFrame>;
}

export default AuthLock;
