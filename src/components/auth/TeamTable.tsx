"use client";

import { useState, useTransition } from "react";
import { setUserRoleAction, setUserPasswordAction, removeUserAction } from "@/app/team/actions";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
}

function RoleBadge({ role }: { role: "admin" | "user" }) {
  return (
    <span
      className={
        role === "admin"
          ? "rounded bg-ledger-50 px-1.5 py-0.5 text-[11px] font-medium text-ledger-700 ring-1 ring-ledger-600/20 ring-inset dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20"
          : "rounded bg-paper-100 px-1.5 py-0.5 text-[11px] font-medium text-paper-600 ring-1 ring-paper-500/20 ring-inset dark:bg-paper-500/10 dark:text-paper-400 dark:ring-paper-500/20"
      }
    >
      {role === "admin" ? "Analyst" : "Subscriber"}
    </span>
  );
}

function PasswordResetControl({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return <span className="text-xs text-statute-600 dark:text-statute-400">Password set</span>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-paper-500 hover:text-paper-900 dark:text-paper-400 dark:hover:text-paper-100"
      >
        Reset password
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await setUserPasswordAction(userId, value);
          if (!result.ok) setError(result.message);
          else setDone(true);
        });
      }}
      className="flex items-center gap-1"
    >
      <input
        type="password"
        required
        minLength={10}
        placeholder="New password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32 rounded border border-paper-300 px-1.5 py-0.5 text-xs text-paper-900 focus:border-paper-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100"
      />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs font-medium text-paper-900 hover:underline disabled:opacity-50 dark:text-paper-100"
      >
        Set
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-paper-400 hover:text-paper-700 dark:hover:text-paper-200"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-rust-600 dark:text-rust-400">{error}</span>}
    </form>
  );
}

export function TeamTable({ users, currentUserId }: { users: TeamUser[]; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<Record<string, string>>({});

  function toggleRole(user: TeamUser) {
    const nextRole = user.role === "admin" ? "user" : "admin";
    setRowError((prev) => ({ ...prev, [user.id]: "" }));
    startTransition(async () => {
      const result = await setUserRoleAction(user.id, nextRole);
      if (!result.ok) setRowError((prev) => ({ ...prev, [user.id]: result.message }));
    });
  }

  function remove(user: TeamUser) {
    if (!confirm(`Remove ${user.email}? This can't be undone.`)) return;
    setRowError((prev) => ({ ...prev, [user.id]: "" }));
    startTransition(async () => {
      const result = await removeUserAction(user.id);
      if (!result.ok) setRowError((prev) => ({ ...prev, [user.id]: result.message }));
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-paper-200 text-left text-xs text-paper-500 dark:border-paper-800 dark:text-paper-400">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Role</th>
            <th className="py-2 pr-4 font-medium">Joined</th>
            <th className="py-2 pr-4 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-paper-100 last:border-0 dark:border-paper-900">
              <td className="py-2.5 pr-4 text-paper-900 dark:text-paper-50">
                {user.name}
                {user.id === currentUserId && <span className="ml-1.5 text-xs text-paper-400">(you)</span>}
              </td>
              <td className="py-2.5 pr-4 text-paper-600 dark:text-paper-400">{user.email}</td>
              <td className="py-2.5 pr-4">
                <RoleBadge role={user.role} />
              </td>
              <td className="py-2.5 pr-4 text-paper-500 dark:text-paper-400">{user.createdAt}</td>
              <td className="py-2.5 pr-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => toggleRole(user)}
                    disabled={isPending || (user.id === currentUserId && user.role === "admin")}
                    className="text-xs text-paper-500 hover:text-paper-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-400 dark:hover:text-paper-100"
                  >
                    {user.role === "admin" ? "Demote to Subscriber" : "Promote to Analyst"}
                  </button>
                  <PasswordResetControl userId={user.id} />
                  <button
                    onClick={() => remove(user)}
                    disabled={isPending || user.id === currentUserId}
                    className="text-xs text-rust-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-rust-400"
                  >
                    Remove
                  </button>
                </div>
                {rowError[user.id] && (
                  <p className="mt-1 text-xs text-rust-600 dark:text-rust-400">{rowError[user.id]}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
