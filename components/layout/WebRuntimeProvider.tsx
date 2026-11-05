"use client";

import {
  DevelopmentBuildProvider,
  LinkProvider,
  RefreshProvider,
  type RuntimeLinkProps,
} from "@cadence/ui/runtime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

export function WebRuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return (
    <DevelopmentBuildProvider value={process.env.NODE_ENV === "development"}>
      <LinkProvider component={WebLink}>
        <RefreshProvider onRefresh={refresh}>{children}</RefreshProvider>
      </LinkProvider>
    </DevelopmentBuildProvider>
  );
}

function WebLink(props: RuntimeLinkProps) {
  return <Link {...props} />;
}
