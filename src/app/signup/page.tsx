import { Suspense } from "react";
import { SignupForm } from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create your account</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Start tracking pharmaceutical patent expirations.
          </p>
        </div>
        <Suspense>
          <SignupForm />
        </Suspense>
      </div>
    </div>
  );
}
