"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyFormState,
} from "@/lib/account/api-keys";

const initial: ApiKeyFormState = { status: "idle" };

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

// Clés de l'API publique (ADR-0019) : création (clé montrée une seule fois), liste, révocation.
export function ApiKeys({ keys, max }: { keys: ApiKeyRow[]; max: number }) {
  const t = useTranslations("account.apiKeys");
  const format = useFormatter();
  const [state, action, pending] = useActionState(createApiKeyAction, initial);
  const nameId = useId();
  const date = (value: Date) => format.dateTime(value, { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-gray-700">{t("intro", { max })}</p>

      {state.status === "created" && state.key && (
        <div role="status" className="flex flex-col gap-2 rounded-lg bg-accent/10 p-4">
          <p className="text-sm font-medium">{t("created")}</p>
          <code className="overflow-x-auto rounded bg-white px-3 py-2 font-mono text-sm">
            {state.key}
          </code>
        </div>
      )}
      {state.status !== "idle" && state.status !== "created" && (
        <p role="alert" className="text-sm text-state-ai">
          {t(`errors.${state.status}`, { max })}
        </p>
      )}

      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            {t("name")}
          </label>
          <input
            id={nameId}
            name="name"
            required
            maxLength={60}
            placeholder={t("namePlaceholder")}
            className="h-11 rounded-lg border border-gray-300 px-3"
          />
        </div>
        <button
          type="submit"
          disabled={pending || keys.length >= max}
          className="h-11 rounded-lg bg-accent px-4 font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {t("create")}
        </button>
      </form>

      {keys.length === 0 ? (
        <p className="text-sm text-gray-600">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-200 rounded-lg border border-gray-200">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{key.name}</span>
                <span className="font-mono text-xs text-gray-600">{key.prefix}…</span>
                <span className="text-xs text-gray-600">
                  {t("createdOn", { date: date(key.createdAt) })} ·{" "}
                  {key.lastUsedAt ? t("lastUsed", { date: date(key.lastUsedAt) }) : t("neverUsed")}
                </span>
              </div>
              <form action={revokeApiKeyAction}>
                <input type="hidden" name="id" value={key.id} />
                <button
                  type="submit"
                  aria-label={t("revokeLabel", { name: key.name })}
                  className="h-11 rounded-lg border border-gray-300 px-4 text-sm font-medium hover:bg-gray-50"
                >
                  {t("revoke")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
