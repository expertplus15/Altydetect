"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { requestMagicLink, signInWithGoogle, type AuthFormState } from "@/lib/auth/actions";

const initialState: AuthFormState = { error: null };

export function AuthForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(requestMagicLink, initialState);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <label htmlFor="email" className="text-sm font-medium text-gray-800">
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("emailPlaceholder")}
          aria-invalid={state.error === "invalidEmail"}
          aria-describedby={state.error ? "auth-error" : undefined}
          className="h-11 rounded-lg border border-gray-300 px-3 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {state.error && (
          <p id="auth-error" role="alert" className="text-sm text-state-ai">
            {t(state.error)}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-accent font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {t("sendLink")}
        </button>
      </form>
      <div className="flex items-center gap-3 text-sm text-gray-600" aria-hidden>
        <span className="h-px flex-1 bg-gray-200" />
        {t("or")}
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <form action={signInWithGoogle}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          type="submit"
          className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-gray-300 font-medium text-gray-900 hover:bg-gray-50"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
            <path
              fill="#EA4335"
              d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.5 17.8 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"
            />
            <path
              fill="#FBBC05"
              d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4-13.4-9.5l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
            />
          </svg>
          {t("google")}
        </button>
      </form>
    </div>
  );
}
