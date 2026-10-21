const env = import.meta.env as Readonly<{
  SITE?: string;
  PUBLIC_CADENCE_APP_URL?: string;
}>;

export const siteConfig = {
  name: "Cadence",
  shortName: "Cadence",
  language: "en",
  marketingSiteUrl:
    env.SITE ?? "https://cadence-marketing-two.vercel.app",
  description:
    "Cadence records recurring behavior through explicit decisions, preserved context, longitudinal review, and portable BehaviorLog data.",
  cadenceAppUrl:
    env.PUBLIC_CADENCE_APP_URL ?? "https://cadence-blush-three.vercel.app",
  standardUrl: "https://github.com/emixd12/BehaviorLog-Bundle",
  githubUrl: "https://github.com/emixd12/cadence",
  desktopPreviewUrl:
    "https://github.com/emixd12/cadence/releases/download/desktop-preview/Cadence_0.1.1-preview.19_aarch64.dmg",
  exampleBundlePath: "/examples/cadence-demo.behaviorlog.zip",
  lastModified: "2026-09-17",
  trustUrl: `${env.PUBLIC_CADENCE_APP_URL ?? "https://cadence-blush-three.vercel.app"}/trust`,
  trustEvidenceUrl: `${env.PUBLIC_CADENCE_APP_URL ?? "https://cadence-blush-three.vercel.app"}/api/public/trust-evidence`,
} as const;

export const primaryCtas = {
  beginRecord: {
    label: "Begin a record",
    href: `${siteConfig.cadenceAppUrl}/login`,
  },
  tryCadence: {
    label: "Try Cadence",
    href: `${siteConfig.cadenceAppUrl}/login`,
  },
  logIn: {
    label: "Log in",
    href: `${siteConfig.cadenceAppUrl}/login`,
  },
  downloadMac: {
    label: "Download for Mac",
    href: siteConfig.desktopPreviewUrl,
  },
  readStandard: {
    label: "Read BehaviorLog",
    href: siteConfig.standardUrl,
  },
  viewStandardRepository: {
    label: "View BehaviorLog repository",
    href: siteConfig.standardUrl,
  },
  downloadExample: {
    label: "Download Example Bundle",
    href: siteConfig.exampleBundlePath,
  },
  viewGithub: {
    label: "View on GitHub",
    href: siteConfig.githubUrl,
  },
} as const;
