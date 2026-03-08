import { useEffect } from "react";
import { Platform } from "react-native";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    document.documentElement.style.overscrollBehaviorX = "none";
    document.body.style.overscrollBehaviorX = "none";
    // Global font reset — forces all elements including inputs to use the system font
    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; }
      input, textarea, button { font: inherit; }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <Slot />
    </>
  );
}
