import type { APIRoute, GetStaticPaths } from "astro";
import { getMarkdownMirror } from "../data/agent-output";
import { marketingRoutes } from "../data/routes";

export const getStaticPaths: GetStaticPaths = () =>
  marketingRoutes
    .filter((route) => route.path !== "/")
    .map((route) => ({
      params: {
        slug: route.markdownPath.slice(1, -3),
      },
      props: {
        routeId: route.routeId,
      },
    }));

export const GET: APIRoute = ({ props }) =>
  new Response(getMarkdownMirror(String(props.routeId)), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });

