import { useEffect, useState } from "react";

const KEY = "cadence:virtual-keyboard";
const EVT = "cadence:virtual-keyboard-change";

export function setVirtualKeyboard(on: boolean) {
  localStorage.setItem(KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}

export function useVirtualKeyboard() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(localStorage.getItem(KEY) === "1");
    read();
    window.addEventListener(EVT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return on;
}
