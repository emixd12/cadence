import { getImageProps } from "next/image";

// The horse banner at the top of Timeline, and of Chat (advisor plan Phase 5B:
// "The horse sits at the top of the page").
const HORSE_BANNER_IMAGES = {
  desktop: {
    src: "/brand/cadence-timeline-horse-lines-dots-clear-background.png",
    width: 2041,
    height: 239,
  },
  mobile: {
    src: "/brand/cadence-timeline-horse-lines-dots-mobile-right-18.png",
    width: 1423,
    height: 367,
  },
} as const;

export function HorseBanner() {
  const sharedImageProps = {
    alt: "",
    "aria-hidden": true,
    className: "block h-full w-full object-fill lg:mt-1",
    fetchPriority: "high",
    loading: "eager",
    sizes: "100vw",
  } as const;

  const {
    props: { sizes: mobileSizes, srcSet: mobileSrcSet },
  } = getImageProps({
    ...sharedImageProps,
    ...HORSE_BANNER_IMAGES.mobile,
  });

  const {
    props: { sizes: desktopSizes, srcSet: desktopSrcSet, ...desktopImageProps },
  } = getImageProps({
    ...sharedImageProps,
    ...HORSE_BANNER_IMAGES.desktop,
  });

  return (
    <div className="w-full overflow-hidden bg-background">
      <div className="aspect-[1423/367] w-full sm:aspect-[2041/239]">
        <picture className="block h-full w-full">
          <source
            media="(max-width: 639px)"
            sizes={mobileSizes}
            srcSet={mobileSrcSet}
          />
          <source
            media="(min-width: 640px)"
            sizes={desktopSizes}
            srcSet={desktopSrcSet}
          />
          <img {...desktopImageProps} alt="" aria-hidden="true" />
        </picture>
      </div>
    </div>
  );
}
