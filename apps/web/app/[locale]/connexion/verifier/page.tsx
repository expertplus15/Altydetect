import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { Link } from "@/i18n/navigation";

export default async function CheckEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as "fr" | "en");
  const t = await getTranslations("auth.verify");
  return (
    <AuthCard
      title={t("title")}
      subtitle={t("body")}
      footer={
        <Link href="/connexion" className="font-medium text-accent underline">
          {t("back")}
        </Link>
      }
    >
      {null}
    </AuthCard>
  );
}
