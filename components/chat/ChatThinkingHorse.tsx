import styles from "./chat-thinking-horse.module.css";

// The Chat thinking mark: shown while a reply is on its way. Decorative; the
// caller supplies the words a screen reader hears.

const THIGH = "M25 36 C23 45 24 52 26.2 58 L30.4 57 C32 51 38 46 38 37 Z";
const HIND_SHIN = "M26.8 57 L29 67.5 L28 71.5 L32.6 71.5 L31 67.5 L29.8 56.5 Z";
const FOREARM = "M69 41 C69.5 47 70.5 52 71.3 56.5 L74.8 56.5 C75.5 52 77.5 47 77.5 41 Z";
const FRONT_SHIN = "M72 56 L72.2 67.5 L71.2 71.5 L75.6 71.5 L74.4 67.5 L74.2 56 Z";
const BODY =
  "M23 31 C25 26 33 25 42 27 C48 28.5 54 28.5 59 27.5 C64 26.5 67 24 70 21 C74 16 79 10.5 85 8 L86 2 L89 7 C93 10 98 17 101 23 C102.5 26 101 29 98 28.5 C95 28 93 26 90 24.5 C89 23.5 87.5 23 86.5 23.5 C86 30 84 36 80 41 C79 46 75 49.5 70 48.5 C63 51 52 49 45 45.5 C41 44 38 47.5 33 47.5 C25 47.5 20 40 23 31 Z";
const TAIL =
  "M24 31 C17 19 5 20 -3 31 C3 28 7 28 9 30 C3 34 -1 40 -2 47 C4 40 9 37 13 38 C9 42 7 47 7 52 C12 44 19 38 25 36 Z";
const MANE =
  "M85 8 C76 2 65 7 54 3 C60 8 58 10 51 10 C59 13 58 16 52 18 C60 19 63 22 58 25 C65 25 70 23 72 20 C76 16 80 11 85 8 Z";
const CURVE = "M0 4.5 C10 0 20 0 30 4.5 S50 9 60 4.5 S80 0 90 4.5 S110 9 120 4.5";

function Leg({ place, far = false }: Readonly<{ place: "front" | "hind"; far?: boolean }>) {
  const front = place === "front";
  return (
    <g className={`${styles.leg} ${front ? styles.front : styles.hind} ${far ? styles.far : ""}`}>
      <path className={styles.edge} d={front ? FOREARM : THIGH} />
      <g className={styles.shin}>
        <path className={styles.edge} d={front ? FRONT_SHIN : HIND_SHIN} />
      </g>
    </g>
  );
}

export function ChatThinkingHorse() {
  return (
    <span className={styles.mark} aria-hidden="true" data-chat-thinking>
      <svg className={styles.horse} viewBox="0 0 120 80" focusable="false">
        <g className={styles.bob}>
          <g className={styles.tail}>
            <path className={styles.plume} d={TAIL} />
          </g>
          <Leg place="hind" far />
          <Leg place="front" far />
          <Leg place="hind" />
          <Leg place="front" />
          <g transform="translate(0 5.6) scale(1 .86)">
            <path className={styles.edge} d={BODY} />
            <g className={styles.mane}>
              <path className={styles.plume} d={MANE} />
            </g>
          </g>
        </g>
      </svg>
      <span className={styles.wave}>
        <svg viewBox="0 0 120 9" preserveAspectRatio="none" focusable="false">
          <path d={CURVE} />
          <circle cx="15" cy="1.3" r="1.3" />
          <circle className={styles.rust} cx="45" cy="7.7" r="1.3" />
          <circle cx="75" cy="1.3" r="1.3" />
          <circle className={styles.rust} cx="105" cy="7.7" r="1.3" />
        </svg>
      </span>
    </span>
  );
}
