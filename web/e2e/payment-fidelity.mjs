// Side-by-side fidelity capture: App (/payment as CASHIER) vs Mockup (Main.dc.html + pay.css)
// across S1-S7 at 390x844, 820x1180, and 1440x900 (plus 320 and 1024 sanity checks).
// Saves strictly under web/e2e/.artifacts/cashier-fidelity/.
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { chromium } from "@playwright/test"

const OUT_DIR = path.resolve("e2e/.artifacts/cashier-fidelity")
fs.mkdirSync(OUT_DIR, { recursive: true })

const MOCKUP_DIR = "D:\\GAM-APP\\docs\\design\\na44-payment-mockup"
const APP_PORT = 43921
const MOCKUP_PORT = 43922
const APP_BASE = `http://127.0.0.1:${APP_PORT}`
const MOCKUP_BASE = `http://127.0.0.1:${MOCKUP_PORT}`

// Lightweight <x-dc> runtime shim so Main.dc.html + pay.css renders locally over HTTP
// without modifying anything in D:\GAM-APP\docs\design\na44-payment-mockup.
const SUPPORT_JS = `
class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(patch) {
    Object.assign(this.state, patch || {});
    if (this._render) this._render();
  }
}
window.DCLogic = DCLogic;

window.addEventListener("DOMContentLoaded", () => {
  const dcEl = document.querySelector("x-dc");
  const scriptEl = document.querySelector("script[data-dc-script]");
  if (!dcEl || !scriptEl) return;

  const helmet = dcEl.querySelector("helmet");
  if (helmet) {
    for (const node of [...helmet.children]) {
      document.head.appendChild(node.cloneNode(true));
    }
    helmet.remove();
  }

  const tplRoot = dcEl.firstElementChild.cloneNode(true);
  const rawProps = JSON.parse(scriptEl.getAttribute("data-props") || "{}");
  const props = {};
  for (const [k, v] of Object.entries(rawProps)) {
    if (v && typeof v === "object" && "default" in v) props[k] = v.default;
  }
  const params = new URLSearchParams(location.search);
  for (const [k, v] of params.entries()) {
    if (v === "true") props[k] = true;
    else if (v === "false") props[k] = false;
    else props[k] = v;
  }

  const ClassDef = new Function("DCLogic", scriptEl.textContent + "; return Component;")(DCLogic);
  const instance = new ClassDef(props);

  function resolvePath(scope, expr) {
    const parts = expr.trim().split(".");
    let cur = scope;
    for (const p of parts) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur === undefined || cur === null ? "" : cur;
  }

  function evalTpl(str, scope) {
    if (!str || !str.includes("{{")) return str;
    const single = str.match(/^\\{\\{([^}]+)\\}\\}$/);
    if (single) return resolvePath(scope, single[1]);
    return str.replace(/\\{\\{([^}]+)\\}\\}/g, (_, expr) => {
      const val = resolvePath(scope, expr);
      return val === undefined || val === null ? "" : String(val);
    });
  }

  function renderNode(tpl, scope) {
    if (tpl.nodeType === Node.TEXT_NODE) {
      const txt = evalTpl(tpl.textContent, scope);
      return document.createTextNode(txt === undefined || txt === null ? "" : String(txt));
    }
    if (tpl.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = tpl.tagName.toLowerCase();
    if (tag === "sc-if") {
      const val = evalTpl(tpl.getAttribute("value") || "", scope);
      if (!val) return document.createDocumentFragment();
      const frag = document.createDocumentFragment();
      for (const ch of tpl.childNodes) {
        const rendered = renderNode(ch, scope);
        if (rendered) frag.appendChild(rendered);
      }
      return frag;
    }
    if (tag === "sc-for") {
      const list = evalTpl(tpl.getAttribute("list") || "", scope);
      const asName = tpl.getAttribute("as") || "item";
      const frag = document.createDocumentFragment();
      if (Array.isArray(list)) {
        for (const item of list) {
          const childScope = Object.assign(Object.create(scope), { [asName]: item });
          for (const ch of tpl.childNodes) {
            const rendered = renderNode(ch, childScope);
            if (rendered) frag.appendChild(rendered);
          }
        }
      }
      return frag;
    }

    const el = document.createElement(tpl.tagName.toLowerCase());
    if (tpl.namespaceURI === "http://www.w3.org/2000/svg") {
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", tpl.tagName.toLowerCase());
      for (const attr of tpl.attributes) {
        svgEl.setAttribute(attr.name, String(evalTpl(attr.value, scope)));
      }
      for (const ch of tpl.childNodes) {
        const rendered = renderNode(ch, scope);
        if (rendered) svgEl.appendChild(rendered);
      }
      return svgEl;
    }

    for (const attr of tpl.attributes) {
      const name = attr.name;
      const val = evalTpl(attr.value, scope);
      if (name === "onclick" && typeof val === "function") {
        el.addEventListener("click", val);
      } else if (name === "onchange" && typeof val === "function") {
        el.addEventListener("input", val);
        el.addEventListener("change", val);
      } else if (name === "disabled" || name === "checked") {
        if (val === true || val === "true") el[name] = true;
      } else if (name === "value") {
        el.value = val == null ? "" : String(val);
      } else {
        el.setAttribute(name, val == null ? "" : String(val));
      }
    }
    for (const ch of tpl.childNodes) {
      const rendered = renderNode(ch, scope);
      if (rendered) el.appendChild(rendered);
    }
    return el;
  }

  let rendering = false;
  function render() {
    if (rendering) return;
    rendering = true;
    try {
      const vals = instance.renderVals();
      const dom = renderNode(tplRoot, vals);
      dcEl.innerHTML = "";
      dcEl.appendChild(dom);
    } finally {
      rendering = false;
    }
  }

  instance._render = render;
  render();
  if (typeof instance.componentDidMount === "function") {
    instance.componentDidMount();
  }
});
`

function startMockupServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || "/").split("?")[0]
      if (reqPath === "/support.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" })
        res.end(SUPPORT_JS)
        return
      }
      const target = reqPath === "/" ? "Main.dc.html" : reqPath.replace(/^\/+/, "")
      const fullPath = path.join(MOCKUP_DIR, target)
      if (!fullPath.startsWith(MOCKUP_DIR) || !fs.existsSync(fullPath)) {
        res.writeHead(404)
        res.end("Not found")
        return
      }
      const ext = path.extname(fullPath)
      const ctype = ext === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8"
      res.writeHead(200, { "content-type": ctype })
      res.end(fs.readFileSync(fullPath))
    })
    server.listen(MOCKUP_PORT, "127.0.0.1", () => resolve(server))
  })
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {
      /* waiting */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const mockupServer = await startMockupServer()
const devServer =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/c", "pnpm", "exec", "vite", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], {
        stdio: "ignore",
      })
    : spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], {
        stdio: "ignore",
      })

if (!(await waitForServer(APP_BASE, 25_000))) {
  devServer.kill()
  mockupServer.close()
  throw new Error("App Vite server failed to start")
}

const launchOptions = {
  headless: true,
  ...(process.platform === "win32" && fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    : {}),
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
}

const browser = await chromium.launch(launchOptions)
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "820", width: 820, height: 1180 },
  { name: "1440", width: 1440, height: 900 },
]

const MOCKUP_QUERIES = {
  s1: "?start=list&panel=false",
  s2: "?start=detail&panel=false&sel=s412",
  s3: "?start=preview&panel=false&sel=s412",
  s4: "?start=method&panel=false&sel=s412",
  s5: "?start=cash&panel=false&sel=s412&cash=500000",
  s6: "?start=qr&panel=false&sel=s412",
  s7: "?start=success&panel=false&sel=s412&method=cash&cash=500000",
}

try {
  for (const vp of VIEWPORTS) {
    // Capture Mockup S1-S7
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      for (const [stepName, qs] of Object.entries(MOCKUP_QUERIES)) {
        await page.goto(`${MOCKUP_BASE}/${qs}`, { waitUntil: "networkidle" })
        await page.waitForTimeout(150)
        await page.screenshot({ path: path.join(OUT_DIR, `mockup-${vp.name}-${stepName}.png`) })
      }
      await ctx.close()
    }

    // Capture App (CASHIER, userId: 5) S1-S7
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        localStorage.setItem("21gam.session.v1", JSON.stringify({ userId: 5, theme: "light" }))
      })
      await page.goto(`${APP_BASE}/payment`, { waitUntil: "networkidle" })
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s1.png`) })

      const a3Row = page.locator(".pay-sess", { hasText: "A3" })
      await a3Row.click()
      await a3Row.click()
      await page.getByRole("heading", { name: "Chi tiết Phiên" }).waitFor()
      await page.waitForTimeout(150)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s2.png`) })

      await page.getByRole("button", { name: "Xem tạm tính" }).click()
      await page.getByRole("button", { name: "Bản in 80mm" }).waitFor()
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s3.png`) })

      await page.getByRole("button", { name: "Chốt bill & thu tiền" }).click()
      await page.getByRole("heading", { name: "Chọn phương thức thanh toán" }).waitFor()
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s4.png`) })

      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.getByRole("heading", { name: "Thanh toán tiền mặt" }).waitFor()
      await page.getByRole("button", { name: "500.000", exact: true }).click()
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s5.png`) })

      await page.getByRole("button", { name: /Chọn phương thức/ }).click()
      await page.getByRole("button", { name: /Chuyển khoản QR/ }).click()
      await page.getByRole("heading", { name: "Chuyển khoản QR" }).waitFor()
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s6.png`) })

      await page.getByRole("button", { name: /Chọn phương thức/ }).click()
      await page.getByRole("button", { name: /Tiền mặt/ }).click()
      await page.getByRole("button", { name: "500.000", exact: true }).click()
      await page.getByRole("button", { name: /Xác nhận đã nhận/ }).click()
      await page.getByRole("heading", { name: "Đã thanh toán" }).waitFor()
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT_DIR, `app-${vp.name}-s7.png`) })

      await ctx.close()
    }
  }
  console.log(`Saved 42 fidelity screenshots (S1-S7 x 390/820/1440 x app/mockup) to ${OUT_DIR}`)
} finally {
  await browser.close()
  devServer.kill()
  mockupServer.close()
}
