import styles from "./chat-thinking-horse.module.css";

// The Chat thinking mark: shown while a reply is on its way. Decorative; the
// caller supplies the words a screen reader hears.

export function ChatThinkingHorse() {
  return (
    <span className={styles.mark} aria-hidden="true" data-chat-thinking>
      <svg className={styles.horse} viewBox="0 0 120 80" focusable="false"><g className={styles.bob}>
        <g className={styles.tail}><path className={styles.ink} d="M23 31 C16 22 6 25 0 35 M23 32 C15 27 6 32 1 44"/><path className={`${styles.ink} ${styles.fine}`} d="M23 33 C16 32 10 38 6 50 M23 33.5 C18 36 15 41 13 48 M19 27.5 C13 25 8 27 4 31"/></g>
        <g className={`${styles.leg} ${styles.hind} ${styles.far}`}><path className={`${styles.ink} ${styles.fill}`} d="M25 36 C23 45 24 52 26.2 58 L30.4 57 C32 51 38 46 38 37 Z"/><g className={styles.shin}><path className={`${styles.ink} ${styles.fill}`} d="M26.8 57 L29 67.5 L28 71.5 L32.6 71.5 L31 67.5 L29.8 56.5 Z"/></g></g>
        <g className={`${styles.leg} ${styles.front} ${styles.far}`}><path className={`${styles.ink} ${styles.fill}`} d="M69 41 C69.5 47 70.5 52 71.3 56.5 L74.8 56.5 C75.5 52 77.5 47 77.5 41 Z"/><g className={styles.shin}><path className={`${styles.ink} ${styles.fill}`} d="M72 56 L72.2 67.5 L71.2 71.5 L75.6 71.5 L74.4 67.5 L74.2 56 Z"/></g></g>
        <g className={`${styles.leg} ${styles.hind}`}><path className={`${styles.ink} ${styles.fill}`} d="M25 36 C23 45 24 52 26.2 58 L30.4 57 C32 51 38 46 38 37 Z"/><g className={styles.shin}><path className={`${styles.ink} ${styles.fill}`} d="M26.8 57 L29 67.5 L28 71.5 L32.6 71.5 L31 67.5 L29.8 56.5 Z"/></g></g>
        <g className={`${styles.leg} ${styles.front}`}><path className={`${styles.ink} ${styles.fill}`} d="M69 41 C69.5 47 70.5 52 71.3 56.5 L74.8 56.5 C75.5 52 77.5 47 77.5 41 Z"/><g className={styles.shin}><path className={`${styles.ink} ${styles.fill}`} d="M72 56 L72.2 67.5 L71.2 71.5 L75.6 71.5 L74.4 67.5 L74.2 56 Z"/></g></g>
        <path className={`${styles.ink} ${styles.fill}`} d="M23 31 C25 26 33 25 42 27 C48 28.5 54 28.5 59 27.5 C64 26.5 67 24 70 21 C74 16 79 10.5 85 8 L86 2 L89 7 C93 10 98 17 101 23 C102.5 26 101 29 98 28.5 C95 28 93 26 90 24.5 C89 23.5 87.5 23 86.5 23.5 C86 30 84 36 80 41 C79 46 75 49.5 70 48.5 C63 51 52 49 45 45.5 C41 44 38 47.5 33 47.5 C25 47.5 20 40 23 31 Z"/>
        <path className={`${styles.ink} ${styles.fine}`} d="M72 29 C70 35 71 40 75 43 M39 31 C42 36 41 41 37 45 M90.5 15 C91.5 19 90.5 22 88 24 M84.5 8 L83 3.5 L86 6.5"/>
        <g className={styles.mane}><path className={styles.ink} d="M84 9 C77 6 68 9 60 6 M80 13 C73 11 65 15 56 12"/><path className={`${styles.ink} ${styles.fine}`} d="M82 11 C75 8 67 12 58 9 M77 17 C71 16 64 20 57 18 M74 20 C69 20 64 23 59 23 M86 8 C88 9 89 11 89.5 12.5"/></g>
        <ellipse className={styles.eye} cx="92" cy="14" rx="1.5" ry="1.2"/><circle className={styles.eye} cx="99.4" cy="25.2" r=".8"/>
        </g></svg>
      <span className={styles.wave}><svg viewBox="0 0 120 9" focusable="false"><path d="M0 4.5 C10 0 20 0 30 4.5 S50 9 60 4.5 S80 0 90 4.5 S110 9 120 4.5"/><circle cx="15" cy="1.3" r="1.3"/><circle className={styles.rust} cx="45" cy="7.7" r="1.3"/><circle cx="75" cy="1.3" r="1.3"/><circle className={styles.rust} cx="105" cy="7.7" r="1.3"/></svg></span>
    </span>
  );
}
