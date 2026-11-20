"use server";

import { revalidatePath } from "next/cache";
import { createApiKey, isPublicApiEnabled, revokeApiKey } from "@/lib/api/keys";
import { getUserPlan } from "@/lib/billing/subscription";
import { requireUser } from "@/lib/server/session";

export interface ApiKeyFormState {
  status: "idle" | "created" | "limit" | "invalid" | "upgrade" | "closed";
  /** Clé complète, montrée une seule fois après sa création. */
  key?: string;
}

/** Création d'une clé d'API (ADR-0019) : API ouverte, compte Pro, 5 clés actives au plus. */
export async function createApiKeyAction(
  _previous: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const user = await requireUser();
  if (!isPublicApiEnabled()) return { status: "closed" };
  if ((await getUserPlan(user.id)).plan !== "pro") return { status: "upgrade" };
  const name = formData.get("name");
  const result = await createApiKey(user.id, typeof name === "string" ? name : "");
  if (!result.ok) return { status: result.reason === "LIMIT_REACHED" ? "limit" : "invalid" };
  revalidatePath("/[locale]/app/compte", "page");
  return { status: "created", key: result.key };
}

/** Révocation immédiate d'une clé du compte. */
export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formData.get("id");
  if (typeof id === "string") await revokeApiKey(user.id, id);
  revalidatePath("/[locale]/app/compte", "page");
}
