import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { Link } from "@/i18n/navigation";
import { safeCallbackUrl } from "@/lib/auth/protected";

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as "fr" | "en");
  const { callbackUrl, error } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      title={t("signIn.title")}
      subtitle={t("signIn.subtitle")}
      footer={
        <>
          {t("signIn.noAccount")}{" "}
          <Link href="/inscription" className="font-medium text-accent underline">
            {t("signIn.toSignUp")}
          </Link>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-sm text-state-ai">
          {t("error")}
        </p>
      )}
      <AuthForm callbackUrl={safeCallbackUrl(callbackUrl, `/${locale}/app`)} />
    </AuthCard>
  );
}
