"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAnalyst } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; message: string };

// Every action re-verifies the caller is an analyst, even though the page
// that renders these controls is already gated by requireAnalyst() — a
// Server Action is a public endpoint in its own right (reachable directly,
// not just via this page's UI), so it must not trust that the UI it was
// rendered from already checked. See Next.js's authentication guide,
// "Server Actions" section.

export async function setUserRoleAction(userId: string, role: "admin" | "user"): Promise<ActionResult> {
  const caller = await requireAnalyst();

  if (userId === caller.id && role !== "admin") {
    return { ok: false, message: "You can't demote your own account." };
  }

  try {
    await auth.api.setRole({ body: { userId, role }, headers: await headers() });
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Failed to update role." };
  }

  revalidatePath("/team");
  return { ok: true };
}

export async function setUserPasswordAction(userId: string, newPassword: string): Promise<ActionResult> {
  await requireAnalyst();

  if (newPassword.length < 10) {
    return { ok: false, message: "Password must be at least 10 characters." };
  }

  try {
    await auth.api.setUserPassword({ body: { userId, newPassword }, headers: await headers() });
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Failed to set password." };
  }

  return { ok: true };
}

export async function removeUserAction(userId: string): Promise<ActionResult> {
  const caller = await requireAnalyst();

  if (userId === caller.id) {
    return { ok: false, message: "You can't remove your own account." };
  }

  try {
    await auth.api.removeUser({ body: { userId }, headers: await headers() });
  } catch (error) {
    console.error(error);
    return { ok: false, message: "Failed to remove user." };
  }

  revalidatePath("/team");
  return { ok: true };
}
