import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Lock, LogIn, Loader2 } from "lucide-react";
import { AuthModal } from "./AuthModal";

interface ProtectedRouteProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

/**
 * Route protection wrapper.
 * Displays verification loading states and clean authentication requirement
 * views when unauthenticated.
 */
export function ProtectedRoute({
  children,
  title = "Authentication Required",
  description = "Please sign in or create an account to access this workflow and synchronize project records.",
}: ProtectedRouteProps) {
  const { user, ready, authLoading } = useStore();
  const [authOpen, setAuthOpen] = useState(false);

  if (!ready || authLoading) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
        <Loader2 className="size-6 animate-spin text-blue-600" />
        <p className="mt-3 text-xs font-medium text-slate-500">
          Verifying authenticated session...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto my-12 max-w-md rounded-lg border border-slate-200 bg-white p-7 text-center shadow-xs">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
          <Lock className="size-5" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button
            onClick={() => setAuthOpen(true)}
            className="h-8 bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-700"
          >
            <LogIn className="mr-1.5 size-3.5" />
            Sign In or Register
          </Button>
        </div>
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultTab="login" />
      </div>
    );
  }

  return <>{children}</>;
}
