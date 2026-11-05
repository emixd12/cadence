"use client";

import {
  createContext,
  createElement,
  useContext,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

const RefreshContext = createContext<(() => void) | null>(null);
export type RuntimeLinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  scroll?: boolean;
};
const LinkContext = createContext<ComponentType<RuntimeLinkProps> | null>(null);
// Unlike the contexts above, this one has a safe default: with no provider, developer text stays hidden.
const DevelopmentBuildContext = createContext(false);

export function LinkProvider({
  component,
  children,
}: Readonly<{
  component: ComponentType<RuntimeLinkProps>;
  children: ReactNode;
}>) {
  return (
    <LinkContext.Provider value={component}>{children}</LinkContext.Provider>
  );
}

export function RuntimeLink(props: RuntimeLinkProps) {
  const LinkComponent = useContext(LinkContext);
  if (!LinkComponent) throw new Error("Cadence UI requires a LinkProvider.");
  return createElement(LinkComponent, props);
}

export function RefreshProvider({
  onRefresh,
  children,
}: Readonly<{ onRefresh: () => void; children: ReactNode }>) {
  return (
    <RefreshContext.Provider value={onRefresh}>
      {children}
    </RefreshContext.Provider>
  );
}

/** Each platform runtime supplies its own build mode. Shared components never read the environment. */
export function DevelopmentBuildProvider({
  value,
  children,
}: Readonly<{ value: boolean; children: ReactNode }>) {
  return (
    <DevelopmentBuildContext.Provider value={value}>
      {children}
    </DevelopmentBuildContext.Provider>
  );
}

export function useDevelopmentBuild(): boolean {
  return useContext(DevelopmentBuildContext);
}

export function useRefresh(): () => void {
  const refresh = useContext(RefreshContext);
  if (!refresh) throw new Error("Cadence UI requires a RefreshProvider.");
  return refresh;
}
