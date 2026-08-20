import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold text-paper-900 dark:text-paper-50">Sign in</h1>
          <p className="text-sm text-paper-500 dark:text-paper-400">Welcome back to Patent Horizon.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
