import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { Link } from "@/i18n/navigation";
import { safeCallbackUrl } from "@/lib/auth/protected";

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as "fr" | "en");
  const { callbackUrl } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <AuthCard
      title={t("signUp.title")}
      subtitle={t("signUp.subtitle")}
      footer={
        <>
          {t("signUp.hasAccount")}{" "}
          <Link href="/connexion" className="font-medium text-accent underline">
            {t("signUp.toSignIn")}
          </Link>
        </>
      }
    >
      <AuthForm callbackUrl={safeCallbackUrl(callbackUrl, `/${locale}/app`)} />
      <p className="text-xs leading-relaxed text-gray-600">
        {t.rich("signUp.consent", {
          terms: (chunks) => (
            <Link href="/cgu" className="underline">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/confidentialite" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthCard>
  );
}
