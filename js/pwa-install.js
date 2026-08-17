// Installierbarkeit: Chrome/Android liefert ein "beforeinstallprompt"-Event,
// das wir abfangen und über einen eigenen Banner anbieten (statt der
// Browser-Standardleiste). iOS/Safari kennt dieses Event nicht – dort zeigen
// wir stattdessen einen Hinweis auf "Zum Home-Bildschirm" im Teilen-Menü.

const $ = (sel) => document.querySelector(sel);

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function initInstallPrompts() {
  if (isStandalone()) return; // bereits installiert/im Standalone-Modus

  let deferredPrompt = null;
  const banner = $("#install-banner");
  const acceptBtn = $("#install-accept");
  const dismissBtn = $("#install-dismiss");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (sessionStorage.getItem("hh-install-dismissed") !== "1") {
      banner.hidden = false;
    }
  });

  acceptBtn?.addEventListener("click", async () => {
    banner.hidden = true;
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  dismissBtn?.addEventListener("click", () => {
    banner.hidden = true;
    sessionStorage.setItem("hh-install-dismissed", "1");
  });

  window.addEventListener("appinstalled", () => {
    banner.hidden = true;
  });

  // iOS-Hinweis nur einmalig pro Browser anzeigen, kein natives Prompt-Event verfügbar.
  if (isIos() && localStorage.getItem("hh-ios-hint-seen") !== "1") {
    const iosHint = $("#ios-install-hint");
    setTimeout(() => {
      iosHint.hidden = false;
    }, 4000);
    $("#ios-hint-dismiss")?.addEventListener("click", () => {
      iosHint.hidden = true;
      localStorage.setItem("hh-ios-hint-seen", "1");
    });
  }
}
