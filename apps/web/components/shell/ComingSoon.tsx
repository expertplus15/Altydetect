import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TOOL_ICONS } from "./icons";

// Outil prévu dans une phase ultérieure : présent dans la navigation, sans impasse.
export async function ComingSoon({ tool }: { tool: "detect" | "plagiarism" }) {
  const t = await getTranslations("comingSoon");
  const Icon = TOOL_ICONS[tool];
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <Icon aria-hidden size={22} />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{t(`${tool}.title`)}</h1>
        <p className="leading-relaxed text-gray-600">{t(`${tool}.body`)}</p>
        <p className="text-sm text-gray-600">{t("meanwhile")}</p>
        <Link
          href="/app/reecrire"
          className="inline-flex h-11 items-center rounded-lg bg-accent px-5 font-semibold text-white hover:opacity-90"
        >
          {t("toRewrite")}
        </Link>
      </div>
    </div>
  );
}
