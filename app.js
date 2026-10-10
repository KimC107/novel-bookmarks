import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2";
const STATUSES = ["在看", "想看", "看完", "棄坑"];
// 設定值還是預留字樣 → 進入本機示範模式（資料只存瀏覽器，不同步，僅供開發測試）
const DEMO = firebaseConfig.apiKey === "PASTE_HERE";

const $ = (s) => document.querySelector(s);
const state = { novels: [], tab: "在看", tag: "", q: "", sort: "lastReadAt", editId: null, progressId: null };
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
      state.novels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
  state.novels = load();
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
  f.status.value = "在看";
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
function ts(n) { return n?.toMillis ? n.toMillis() : Number(n) || 0; }
function fmtDate(ms) {
  if (!ms) return "尚未閱讀";
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function render() {
  // 分頁（顯示各狀態數量）
  $("#tabs").innerHTML = STATUSES.map((s) => {
    const n = state.novels.filter((x) => x.status === s).length;
    return `<button class="tab ${s === state.tab ? "active" : ""}" data-tab="${s}">${s} ${n}</button>`;
  }).join("");

  // 目前分頁內的所有標籤
  const inTab = state.novels.filter((n) => n.status === state.tab);
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
  rows.sort((a, b) =>
    by === "title" ? a.title.localeCompare(b.title, "zh-Hant")
    : by === "rating" ? (b.rating || 0) - (a.rating || 0)
    : ts(b[by]) - ts(a[by])
  );

  $("#empty").classList.toggle("hidden", rows.length > 0);
  $("#list").innerHTML = rows.map((n) => {
    const canRead = safeUrl(n.chapterUrl) || safeUrl(n.siteUrl);
    return `<li class="card" data-id="${esc(n.id)}">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(n.title)}</div>
          <div class="card-sub">${esc(n.author || "作者不詳")} · ${fmtDate(ts(n.lastReadAt))}</div>
        </div>
        <div class="rating">${"★".repeat(n.rating || 0)}</div>
      </div>
      <div class="meta">
        ${n.chapterName ? `<span class="chapter">📖 ${esc(n.chapterName)}</span>` : ""}
        ${(n.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}
      </div>
      ${n.note ? `<div class="note">${esc(n.note)}</div>` : ""}
      <div class="card-actions">
        <button class="btn primary" data-act="read" ${canRead ? "" : "disabled"}>繼續閱讀</button>
        <button class="btn" data-act="progress">更新進度</button>
        <button class="btn" data-act="edit">編輯</button>
      </div>
    </li>`;
  }).join("");
}

// ---------- 操作 ----------
let ids;
const now = () => Date.now();

function openEdit(id) {
  const f = $("#editForm");
  state.editId = id;
  const n = id ? state.novels.find((x) => x.id === id) : null;
  $("#editTitle").textContent = n ? "編輯小說" : "新增小說";
  $("#deleteBtn").classList.toggle("hidden", !n);
  f.reset();
  if (n) {
    for (const k of ["title", "author", "siteUrl", "chapterName", "chapterUrl", "status", "rating", "note"]) f.elements[k].value = n[k] ?? "";
    f.elements.tags.value = (n.tags || []).join(", ");
  } else {
    f.elements.status.value = STATUSES.includes(state.tab) ? state.tab : "想看";
  }
  $("#editDlg").showModal();
}

$("#editForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const id = state.editId || ids.newId();
  const data = {
    title: f.title.value.trim(), author: f.author.value.trim(),
    siteUrl: f.siteUrl.value.trim(), chapterName: f.chapterName.value.trim(),
    chapterUrl: f.chapterUrl.value.trim(), status: f.status.value,
    rating: Number(f.rating.value), note: f.note.value.trim(),
    // 逗號（半形、全形）與頓號都可分隔標籤
    tags: f.tags.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
  };
  if (!state.editId) { data.createdAt = now(); data.lastReadAt = 0; }
  $("#editDlg").close();
  state.tab = data.status; // 儲存後跳到該狀態分頁，才看得到剛存的書
  await store.save(id, data);
};

$("#deleteBtn").onclick = async () => {
  const n = state.novels.find((x) => x.id === state.editId);
  if (n && confirm(`確定刪除「${n.title}」？`)) { $("#editDlg").close(); await store.remove(n.id); }
};

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
    $("#progressDlg").showModal();
  }
  if (btn.dataset.act === "read") {
    const url = safeUrl(n.chapterUrl) || safeUrl(n.siteUrl);
    window.open(url, "_blank", "noopener");
    // 想看的書開始閱讀後自動轉成在看
    await store.save(id, { lastReadAt: now(), ...(n.status === "想看" ? { status: "在看" } : {}) });
  }
};

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
    download: `novel-bookmarks-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- 啟動 ----------
ids = DEMO ? initDemo() : await initFirebase();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
