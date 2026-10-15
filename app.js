import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2";
const TYPES = ["小說", "漫畫", "短劇"];
// 各類型的狀態分頁；短劇的「進行」換成「完結」
const STATUS_BY_TYPE = {
  小說: ["進行", "追更", "未看", "已閱", "棄坑"],
  漫畫: ["進行", "追更", "未看", "已閱", "棄坑"],
  短劇: ["完結", "追更", "未看", "已閱", "棄坑"],
};
const statusesOf = (t) => STATUS_BY_TYPE[t] || STATUS_BY_TYPE["小說"];
// 舊版狀態名稱 → 新版（既有資料會自動轉換並寫回）
const LEGACY_STATUS = { "在看": "進行", "想看": "未看", "看完": "已閱" };
const normalize = (n) => ({ ...n, type: n.type || "小說", status: LEGACY_STATUS[n.status] || n.status, episodes: n.episodes || [] });
// 設定值還是預留字樣 → 進入本機示範模式（資料只存瀏覽器，不同步，僅供開發測試）
const DEMO = firebaseConfig.apiKey === "PASTE_HERE";

// 記住上次選的類型（瀏覽器禁用儲存時忽略）
function loadType() {
  try { const t = localStorage.getItem("bookmarkType"); return TYPES.includes(t) ? t : "小說"; } catch { return "小說"; }
}

const $ = (s) => document.querySelector(s);
const state = { novels: [], type: loadType(), tab: "進行", tag: "", q: "", sort: "lastReadAt", editId: null, progressId: null, epId: null };
let store; // 資料層：{ save(id, data), remove(id) }，變動時呼叫 onData

// ---------- 資料層：Firebase ----------
async function initFirebase() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  // 開啟離線快取（多分頁模式），斷網時仍可讀寫，連線後自動同步
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });

  $("#loginBtn").onclick = async () => {
    $("#loginMsg").textContent = "";
    try {
      await auth.signInWithPopup(a, new auth.GoogleAuthProvider());
    } catch (e) {
      // 彈窗被擋或不支援時改用跳轉登入
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
        return auth.signInWithRedirect(a, new auth.GoogleAuthProvider());
      }
      $("#loginMsg").textContent = `登入失敗：${e.code || e.message}`;
    }
  };
  $("#logoutBtn").onclick = () => auth.signOut(a);

  auth.onAuthStateChanged(a, (user) => {
    if (!user) return showLogin();
    $("#userInfo").textContent = user.email;
    const col = fs.collection(db, "users", user.uid, "novels");
    store = {
      save: (id, data) => fs.setDoc(fs.doc(col, id), data, { merge: true }),
      remove: (id) => fs.deleteDoc(fs.doc(col, id)),
    };
    // 即時監聽，其他裝置有改動會馬上更新
    fs.onSnapshot(col, (snap) => {
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.novels = raw.map(normalize);
      raw.filter((n) => LEGACY_STATUS[n.status]).forEach((n) => store.save(n.id, { status: LEGACY_STATUS[n.status] }));
      render();
    });
    showApp();
  });
  return { newId: () => fs.doc(fs.collection(db, "_")).id };
}

// ---------- 資料層：本機示範 ----------
function initDemo() {
  const KEY = "novel-bookmarks-demo";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state.novels));
  state.novels = load().map(normalize);
  store = {
    save: async (id, data) => {
      const i = state.novels.findIndex((n) => n.id === id);
      if (i >= 0) state.novels[i] = { ...state.novels[i], ...data };
      else state.novels.push({ id, ...data });
      persist(); render();
    },
    remove: async (id) => { state.novels = state.novels.filter((n) => n.id !== id); persist(); render(); },
  };
  $("#userInfo").textContent = "本機示範模式（未連線 Firebase，資料不同步）";
  $("#logoutBtn").classList.add("hidden");
  showApp();
  return { newId: () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
}

function showLogin() { $("#loginView").classList.remove("hidden"); $("#appView").classList.add("hidden"); }
function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  render();
  openPendingAdd();
}

// ---------- iOS 捷徑：網址參數帶入新增 ----------
// 捷徑開啟 ?add=<網址>&title=<標題>，先暫存到 sessionStorage 並清掉網址列，
// 這樣即使要先登入（頁面重新載入）參數也不會遺失
try {
  const qs = new URLSearchParams(location.search);
  if (qs.has("add")) {
    sessionStorage.setItem("pendingAdd", JSON.stringify({ url: qs.get("add"), title: qs.get("title") || "" }));
    history.replaceState(null, "", location.pathname);
  }
} catch { /* 瀏覽器禁用儲存時忽略，只是不會預填 */ }

// 登入完成、進入主畫面後，開啟預填好的新增表單
function openPendingAdd() {
  let p;
  try { p = JSON.parse(sessionStorage.getItem("pendingAdd")); sessionStorage.removeItem("pendingAdd"); } catch { return; }
  if (p) openPrefilled(p);
}

// 開啟新增表單並預填書名與連結
function openPrefilled(p) {
  openEdit(null);
  const f = $("#editForm").elements;
  f.title.value = p.title;
  // 分享的頁面多半是章節頁，網站連結與章節連結都先填入，使用者可自行修改
  if (safeUrl(p.url)) { f.siteUrl.value = p.url; f.chapterUrl.value = p.url; }
  f.status.value = statusesOf(f.type.value)[0];
}

// 📋 從剪貼簿新增：剪貼簿內容可以是「標題＋換行＋網址」，也可以只有網址
async function addFromClipboard() {
  let text = "";
  try {
    text = await navigator.clipboard.readText(); // iOS 會跳出「貼上」確認
  } catch {
    // 瀏覽器不允許讀取剪貼簿時，改讓使用者手動貼上
    text = prompt("無法自動讀取剪貼簿，請貼上網址（可含標題）：") || "";
  }
  const m = text.match(/https?:\/\/\S+/);
  if (!m) { if (text) alert("剪貼簿裡沒有找到網址"); return; }
  const title = text.replace(m[0], "").trim().split("\n")[0].trim();
  openPrefilled({ url: m[0], title });
}

// ---------- 畫面 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 只允許 http(s) 連結，避免 javascript: 之類的網址被點到
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
function fmtDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
// 集數摘要：只有單集時顯示「單集 · 已看/未看」，否則「已看 x/y 集」
function epSummary(eps) {
  if (eps.length === 1 && eps[0].single) return `單集 · ${eps[0].watched ? "已看" : "未看"}`;
  return `已看 ${eps.filter((e) => e.watched).length}/${eps.length} 集`;
}
function ts(n) { return n?.toMillis ? n.toMillis() : Number(n) || 0; }
function fmtDate(ms, watch = false) {
  if (!ms) return watch ? "尚未觀看" : "尚未閱讀";
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function render() {
  // 小說／漫畫切換
  $("#typeSwitch").innerHTML = TYPES.map((t) => `<button class="${t === state.type ? "active" : ""}" data-type="${t}">${t}</button>`).join("");
  const ofType = state.novels.filter((n) => n.type === state.type);
  // 切換類型後，目前分頁若不屬於該類型（例如短劇沒有「進行」），退回第一個分頁
  if (!statusesOf(state.type).includes(state.tab)) state.tab = statusesOf(state.type)[0];
  // 分頁（顯示各狀態數量）
  $("#tabs").innerHTML = statusesOf(state.type).map((s) => {
    const n = ofType.filter((x) => x.status === s).length;
    return `<button class="tab ${s === state.tab ? "active" : ""}" data-tab="${s}">${s} ${n}</button>`;
  }).join("");

  // 目前分頁內的所有標籤
  const inTab = ofType.filter((n) => n.status === state.tab);
  const tags = [...new Set(inTab.flatMap((n) => n.tags || []))];
  if (state.tag && !tags.includes(state.tag)) state.tag = "";
  $("#tagBar").innerHTML = tags.map((t) => `<button class="tag ${t === state.tag ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)}</button>`).join("");

  // 搜尋、標籤篩選、排序
  const q = state.q.trim().toLowerCase();
  let rows = inTab.filter((n) =>
    (!state.tag || (n.tags || []).includes(state.tag)) &&
    (!q || `${n.title} ${n.author || ""}`.toLowerCase().includes(q))
  );
  const by = state.sort;
  const cmp = (a, b) =>
    by === "title" ? a.title.localeCompare(b.title, "zh-Hant")
    : by === "rating" ? (b.rating || 0) - (a.rating || 0)
    : ts(b[by]) - ts(a[by]);
  // 已閱分頁固定先依星級多到少排，同星級再用所選排序
  rows.sort((a, b) => (state.tab === "已閱" ? (b.rating || 0) - (a.rating || 0) : 0) || cmp(a, b));

  $("#empty").classList.toggle("hidden", rows.length > 0);
  $("#list").innerHTML = rows.map((n) => {
    const drama = n.type === "短劇";
    const eps = n.episodes || [];
    const canRead = safeUrl(n.chapterUrl) || safeUrl(n.siteUrl);
    const toc = safeUrl(n.siteUrl)
      ? `<a class="btn" href="${esc(safeUrl(n.siteUrl))}" target="_blank" rel="noopener">目錄</a>`
      : '<button class="btn" disabled>目錄</button>';
    return `<li class="card" data-id="${esc(n.id)}">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(n.title)}</div>
          <div class="card-sub">${drama ? "" : esc(n.author || "作者不詳") + " · "}${fmtDate(ts(n.lastReadAt), drama)}</div>
        </div>
        <div class="rating">${"★".repeat(n.rating || 0)}</div>
      </div>
      <div class="meta">
        ${drama
          ? `<span class="chapter">🎬 ${epSummary(eps)}</span>`
          : n.chapterName ? `<span class="chapter">📖 ${esc(n.chapterName)}</span>` : ""}
        ${(n.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}
      </div>
      ${n.note ? `<div class="note">${esc(n.note)}</div>` : ""}
      <div class="card-actions">
        ${drama
          ? '<button class="btn primary" data-act="eps">集數</button>'
          : `<button class="btn primary" data-act="read" ${canRead ? "" : "disabled"}>繼續閱讀</button>${toc}<button class="btn orange" data-act="progress">更新進度</button>`}
        <button class="btn" data-act="edit">編輯</button>
      </div>
    </li>`;
  }).join("");
  renderEpisodes(); // 集數視窗開著時，資料變動（含其他裝置同步）要跟著更新
}

// ---------- 操作 ----------
let ids;
const now = () => Date.now();

function openEdit(id) {
  const f = $("#editForm");
  state.editId = id;
  const n = id ? state.novels.find((x) => x.id === id) : null;
  $("#editTitle").textContent = n ? "編輯作品" : "新增作品";
  $("#deleteBtn").classList.toggle("hidden", !n);
  f.reset();
  if (n) {
    for (const k of ["type", "title", "author", "siteUrl", "chapterName", "chapterUrl", "rating", "note"]) f.elements[k].value = n[k] ?? "";
    f.elements.tags.value = (n.tags || []).join(", ");
    syncEditForm(n.status);
  } else {
    f.elements.type.value = state.type;
    syncEditForm(statusesOf(state.type).includes(state.tab) ? state.tab : "未看");
  }
  $("#editDlg").showModal();
}

// 依選的類型重建狀態選項，並隱藏該類型用不到的欄位（短劇用集數清單，不需要章節欄位）
function syncEditForm(keepStatus) {
  const f = $("#editForm").elements;
  const type = f.type.value;
  const list = statusesOf(type);
  const keep = keepStatus ?? f.status.value;
  f.status.innerHTML = list.map((s) => `<option>${s}</option>`).join("");
  f.status.value = list.includes(keep) ? keep : list[0];
  document.querySelectorAll("#editForm [data-types]").forEach((el) =>
    el.classList.toggle("hidden", !el.dataset.types.split(",").includes(type))
  );
}
$("#editForm").elements.type.onchange = () => syncEditForm();

$("#editForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const id = state.editId || ids.newId();
  const data = {
    type: f.type.value, title: f.title.value.trim(), author: f.author.value.trim(),
    siteUrl: f.siteUrl.value.trim(), chapterName: f.chapterName.value.trim(),
    chapterUrl: f.chapterUrl.value.trim(), status: f.status.value,
    rating: Number(f.rating.value), note: f.note.value.trim(),
    // 逗號（半形、全形）與頓號都可分隔標籤
    tags: f.tags.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
  };
  if (!state.editId) { data.createdAt = now(); data.lastReadAt = 0; }
  $("#editDlg").close();
  state.tab = data.status; // 儲存後跳到該類型與狀態分頁，才看得到剛存的書
  setType(data.type);
  await store.save(id, data);
};

$("#deleteBtn").onclick = async () => {
  const n = state.novels.find((x) => x.id === state.editId);
  if (n && confirm(`確定刪除「${n.title}」？`)) { $("#editDlg").close(); await store.remove(n.id); }
};

// 更新進度：貼上新連結時，章節名稱自動帶入連結最後的數字（例如 ...?chapterNumber=12 → 12）
// 使用者自己改過名稱後就不再覆蓋；每次開啟視窗會重置
const pf = $("#progressForm").elements;
let nameTouched = false;
pf.chapterName.addEventListener("input", () => { nameTouched = true; });
pf.chapterUrl.addEventListener("input", () => {
  if (nameTouched) return;
  const m = pf.chapterUrl.value.trim().split("#")[0].match(/(\d+)(?!.*\d)/); // 最後一段連續數字（略過 # 之後）
  pf.chapterName.value = m ? m[1] : "";
});

$("#progressForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  $("#progressDlg").close();
  await store.save(state.progressId, { chapterUrl: f.chapterUrl.value.trim(), chapterName: f.chapterName.value.trim(), lastReadAt: now() });
};

// 卡片按鈕（事件委派）
$("#list").onclick = async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".card").dataset.id;
  const n = state.novels.find((x) => x.id === id);
  if (btn.dataset.act === "edit") return openEdit(id);
  if (btn.dataset.act === "progress") {
    state.progressId = id;
    $("#progressTitle").textContent = `更新進度：${n.title}`;
    $("#progressForm").reset();
    nameTouched = false;
    $("#progressDlg").showModal();
  }
  if (btn.dataset.act === "eps") { openEpisodes(id); return; }
  if (btn.dataset.act === "read") {
    const url = safeUrl(n.chapterUrl) || safeUrl(n.siteUrl);
    window.open(url, "_blank", "noopener");
    // 未看的書開始閱讀後自動轉成進行
    await store.save(id, { lastReadAt: now(), ...(n.status === "未看" ? { status: "進行" } : {}) });
  }
};

// ---------- 短劇：集數清單 ----------
const epId = () => "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function openEpisodes(id) {
  state.epId = id;
  $("#epForm").reset();
  $("#epBulk").value = "";
  $("#epDlg").showModal(); // 要先開視窗，renderEpisodes 才不會因為「視窗沒開」而略過
  renderEpisodes();
}

// 集數視窗內容；視窗沒開或該作品被刪掉時什麼都不做
function renderEpisodes() {
  if (!$("#epDlg").open) return;
  const n = state.novels.find((x) => x.id === state.epId);
  if (!n) { $("#epDlg").close(); return; }
  const eps = n.episodes || [];
  $("#epTitle").textContent = n.title;
  // 只有單集的作品不能再新增集數：收起新增表單與批次新增，刪掉單集後才會再出現
  const hasSingle = eps.some((e) => e.single);
  $("#epForm").classList.toggle("hidden", hasSingle);
  $("#epDlg .ep-bulk").classList.toggle("hidden", hasSingle);
  $("#epSummary").textContent = eps.length ? epSummary(eps) : "還沒有集數，請在下方新增";
  syncEpForm(eps.length);
  $("#epList").innerHTML = eps.map((e) => `<li class="ep ${e.watched ? "seen" : ""}" data-eid="${esc(e.id)}">
    <button type="button" class="ep-check" data-eact="toggle" aria-label="切換已看">${e.watched ? "✓" : "○"}</button>
    ${safeUrl(e.url)
      ? `<a class="ep-name" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener" data-eact="open">${esc(e.name)}</a>`
      : `<span class="ep-name">${esc(e.name)}</span>`}
    <span class="ep-date">${e.watched && e.watchedAt ? fmtDay(e.watchedAt) : ""}</span>
    <button type="button" class="ep-del" data-eact="del" aria-label="刪除此集">🗑</button>
  </li>`).join("");
}

// 新增表單：勾「單集」時名稱固定為「單集」，不用填名稱
function syncEpForm(count = curEps().eps.length) {
  const f = $("#epForm").elements;
  f.name.disabled = f.single.checked;
  f.name.placeholder = f.single.checked ? "單集" : `第${count + 1}集（可改名）`;
}
$("#epForm").elements.single.onchange = () => syncEpForm();

// 目前集數視窗對應的作品與集數陣列
function curEps() {
  const n = state.novels.find((x) => x.id === state.epId);
  return { n, eps: n ? [...(n.episodes || [])] : [] };
}

// 清單內的按鈕與連結（事件委派）
$("#epList").onclick = async (e) => {
  const el = e.target.closest("[data-eact]");
  if (!el) return;
  const eid = el.closest(".ep").dataset.eid;
  const { n, eps } = curEps();
  if (!n) return;
  if (el.dataset.eact === "toggle") {
    await store.save(n.id, { episodes: eps.map((x) => (x.id === eid ? { ...x, watched: !x.watched, watchedAt: x.watched ? 0 : now() } : x)) });
  } else if (el.dataset.eact === "del") {
    await store.save(n.id, { episodes: eps.filter((x) => x.id !== eid) });
  } else if (el.dataset.eact === "open") {
    // 讓連結照常開啟新分頁；標記已看延後一拍，避免重繪把被點的連結元素換掉而中斷導覽
    setTimeout(() => store.save(n.id, { lastReadAt: now(), episodes: eps.map((x) => (x.id === eid ? { ...x, watched: true, watchedAt: x.watched ? x.watchedAt : now() } : x)) }), 0);
  }
};

// 單筆新增
$("#epForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const { n, eps } = curEps();
  if (!n) return;
  const single = f.single.checked;
  eps.push({
    id: epId(), name: single ? "單集" : f.name.value.trim() || `第${eps.length + 1}集`,
    url: f.url.value.trim(), watched: false, ...(single ? { single: true } : {}),
  });
  e.target.reset();
  syncEpForm(eps.length);
  await store.save(n.id, { episodes: eps });
};

// 批次新增：一行一集，行內若有文字就當集數名稱，否則依序編號
$("#epBulkBtn").onclick = async () => {
  const { n, eps } = curEps();
  if (!n) return;
  const added = [];
  for (const line of $("#epBulk").value.split("\n")) {
    const m = line.match(/https?:\/\/\S+/);
    if (!m) continue;
    const label = line.replace(m[0], "").trim();
    added.push({ id: epId(), name: label || `第${eps.length + added.length + 1}集`, url: m[0], watched: false });
  }
  if (!added.length) { alert("沒有找到網址，請一行貼一個連結"); return; }
  $("#epBulk").value = "";
  await store.save(n.id, { episodes: [...eps, ...added] });
};

function setType(t) {
  state.type = t;
  try { localStorage.setItem("bookmarkType", t); } catch { /* 忽略 */ }
}
$("#typeSwitch").onclick = (e) => { const t = e.target.dataset.type; if (t) { setType(t); state.tag = ""; render(); } };
$("#tabs").onclick = (e) => { const t = e.target.dataset.tab; if (t) { state.tab = t; render(); } };
$("#tagBar").onclick = (e) => { const t = e.target.dataset.tag; if (t !== undefined) { state.tag = state.tag === t ? "" : t; render(); } };
$("#searchInput").oninput = (e) => { state.q = e.target.value; render(); };
$("#sortSelect").onchange = (e) => { state.sort = e.target.value; render(); };
$("#addBtn").onclick = () => openEdit(null);
$("#menuBtn").onclick = () => $("#menuDlg").showModal();
$("#pasteBtn").onclick = addFromClipboard;

// 所有對話框的「取消／關閉」按鈕
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state.novels, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `hobby-bookmarks-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- 啟動 ----------
ids = DEMO ? initDemo() : await initFirebase();
if ("serviceWorker" in navigator) {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    // 本機開發不使用 Service Worker，並清掉先前註冊的，避免測試時吃到舊快取
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
  } else {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
