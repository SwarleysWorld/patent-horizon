"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signUpError } = await authClient.signUp.email({ name, email, password });

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Couldn't create an account with those details.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-xs font-medium text-paper-600 dark:text-paper-400">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-paper-300 bg-paper-100 px-3 py-1.5 text-sm text-paper-900 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-xs font-medium text-paper-600 dark:text-paper-400">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-paper-300 bg-paper-100 px-3 py-1.5 text-sm text-paper-900 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-xs font-medium text-paper-600 dark:text-paper-400">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-paper-300 bg-paper-100 px-3 py-1.5 text-sm text-paper-900 focus:border-paper-500 focus:ring-1 focus:ring-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
        />
        <p className="text-xs text-paper-400 dark:text-paper-600">At least 10 characters.</p>
      </div>

      {error && <p className="text-sm text-rust-600 dark:text-rust-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-paper-900 px-3 py-1.5 text-sm font-medium text-paper-50 hover:bg-paper-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-300"
      >
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="text-sm text-paper-500 dark:text-paper-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-paper-900 hover:underline dark:text-paper-100">
          Sign in
        </Link>
      </p>
    </form>
  );
}
