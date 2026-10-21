import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/oauth/ConsentForm";
import { buildLoginPath } from "@/lib/auth/redirects";
import { getConsentPageData } from "@/lib/services/oauth-ui.service";
import { consentAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const params = await searchParams;
  const requestId = typeof params.request === "string" ? params.request : "";
  let consent;
  try {
    consent = await getConsentPageData(requestId);
  } catch {
    return <main className="mx-auto max-w-xl px-5 py-12"><h1 className="text-2xl">Connection request unavailable</h1><p className="mt-4 text-sm leading-6">This request has expired or could not be verified. Start again from the app you want to connect.</p><a href="/settings#connected-apps" className="product-action product-action-secondary mt-6 inline-flex min-h-11 items-center">Open Connected apps</a></main>;
  }
  if (!consent) redirect(buildLoginPath(`/oauth/consent?request=${encodeURIComponent(requestId)}`));
  return <main className="mx-auto w-full max-w-xl px-5 py-8 sm:py-12"><p className="mb-6 text-lg">Cadence</p><ConsentForm consent={consent} action={consentAction} /></main>;
}
