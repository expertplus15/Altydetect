"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { deleteAccount, savePreferences, type AccountFormState } from "@/lib/account/actions";

const initial: AccountFormState = { status: "idle" };

export function PreferencesForm({
  locale,
  trainingOptIn,
}: {
  locale: "fr" | "en";
  trainingOptIn: boolean;
}) {
  const t = useTranslations("account");
  const [state, action, pending] = useActionState(savePreferences, initial);
  const languageId = useId();
  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={languageId} className="font-semibold">
          {t("language")}
        </label>
        <select
          id={languageId}
          name="locale"
          defaultValue={locale}
          className="h-11 max-w-xs rounded-lg border border-gray-300 bg-white px-3"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
        <p className="text-sm text-gray-600">{t("languageHint")}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("training")}</legend>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="trainingOptIn"
            defaultChecked={trainingOptIn}
            className="mt-0.5 h-5 w-5 accent-accent"
          />
          <span className="flex flex-col gap-1">
            <span>{t("trainingLabel")}</span>
            <span className="text-sm leading-relaxed text-gray-600">{t("trainingHint")}</span>
          </span>
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-accent px-5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {t("save")}
        </button>
        {state.status === "saved" && (
          <p role="status" className="text-sm text-gray-600">
            {t("saved")}
          </p>
        )}
      </div>
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const t = useTranslations("account");
  const [state, action, pending] = useActionState(deleteAccount, initial);
  const inputId = useId();
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-gray-700">{t("deleteBody")}</p>
      <label htmlFor={inputId} className="text-sm">
        {t("deleteConfirm", { email })}
      </label>
      <input
        id={inputId}
        name="confirmEmail"
        type="email"
        autoComplete="off"
        required
        className="h-11 max-w-sm rounded-lg border border-gray-300 px-3"
      />
      {state.status === "mismatch" && (
        <p role="alert" className="text-sm text-state-ai">
          {t("deleteMismatch")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-11 self-start rounded-lg border border-state-ai px-5 font-semibold text-state-ai hover:bg-state-ai/5 disabled:opacity-60"
      >
        {t("deleteButton")}
      </button>
    </form>
  );
}
