import { useEffect, useState } from "react";
import { localDayAt } from "@/lib/learning-state.shared";
import { getUserTimeZone } from "@/lib/learning-state.runtime";

export function useLocalCalendar() {
  const [calendar, setCalendar] = useState<{ timeZone: string; day: string } | null>(null);

  useEffect(() => {
    let timer: number;
    const update = () => {
      const timeZone = getUserTimeZone();
      const day = localDayAt(new Date(), timeZone);
      setCalendar((current) =>
        current?.timeZone === timeZone && current.day === day ? current : { timeZone, day },
      );
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(update, Math.max(1000, midnight.getTime() - Date.now() + 100));
    };
    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", updateWhenVisible);
    };
  }, []);

  return calendar;
}
