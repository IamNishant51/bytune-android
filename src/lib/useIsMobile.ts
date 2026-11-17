/** Width-driven shell variant: phones and narrow desktop windows get the
 *  single-pane layout. The query is the same one `index.css` keys off. */
import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 860px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_QUERY).matches
      : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (): void => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
