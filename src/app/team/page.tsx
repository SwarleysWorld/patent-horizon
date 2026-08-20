import { prisma } from "@/lib/prisma";
import { requireAnalyst } from "@/lib/session";
import { TeamTable } from "@/components/auth/TeamTable";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const currentUser = await requireAnalyst();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-paper-900 dark:text-paper-50">Team</h1>
        <p className="text-sm text-paper-500 dark:text-paper-400">
          Manage who has access and who can make changes. Analysts can view and edit everything;
          Subscribers have read-only access to the product.
        </p>
      </div>
      <TeamTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role === "admin" ? "admin" : "user",
          createdAt: u.createdAt.toISOString().slice(0, 10),
        }))}
        currentUserId={currentUser.id}
      />
    </div>
  );
}
