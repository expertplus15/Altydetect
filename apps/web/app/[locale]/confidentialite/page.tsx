import { setRequestLocale } from "next-intl/server";
import { LegalPage, legalMetadata } from "@/components/public/LegalPage";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return legalMetadata("privacy", (await params).locale as "fr" | "en");
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale as "fr" | "en");
  return <LegalPage kind="privacy" />;
}
