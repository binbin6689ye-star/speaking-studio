/* 开口讲粤语: for people who understand Cantonese but don't speak it.
   Listen with the phone's own Cantonese voice, read along with Jyutping, record yourself, compare.
   No scoring, no server: recordings stay on the phone (IndexedDB). */
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

/* ---------- content: every item becomes {id, text, jp, a?, ajp?, ex?} ---------- */
const ITEMS = {}, TOPICS = [];
Object.entries(YUE.scenes).forEach(([k,[label,rows]]) => {
  TOPICS.push([k, label]);
  rows.forEach((r,i) => { ITEMS[`${k}-${i}`] = {id:`${k}-${i}`, topic:k, text:r[0], jp:r[1]}; });
});
TOPICS.push(["xhy", "歇后语"]);
YUE.xhy.forEach((r,i) => { ITEMS[`xhy-${i}`] = {id:`xhy-${i}`, topic:"xhy", text:r[0], jp:r[1], a:r[2], ajp:r[3], ex:r[4]}; });
const LABEL = Object.fromEntries(TOPICS); LABEL.mix = "全部混合";
const byTopic = t => Object.values(ITEMS).filter(x => t === "mix" || x.topic === t).map(x => x.id);
/* what the voice reads: for 歇后语 both halves (with the pun's real word, not the bracketed one) */
const spoken = it => it.a ? `${it.text}，${it.a.replace(/（.*?）/g, "")}` : it.text;
const fullText = it => it.a ? `${it.text}——${it.a}` : it.text;

/* ---------- storage ---------- */
const SKEY = "yueApp.v1";
let store; try { store = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch(e){ store = {}; }
store.days = store.days || {}; store.practiced = store.practiced || {}; store.reviewed = store.reviewed || {};
store.rate = store.rate || 0.9; if(store.showJp === undefined) store.showJp = true;
const saveStore = () => { try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch(e){} };
const dkey = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function logRep(){ const k = dkey(new Date()); store.days[k] = (store.days[k]||0) + 1; saveStore(); renderStats(); }
function renderStats(){
  $("#st-reps").textContent = store.days[dkey(new Date())] || 0;
  let n=0; const d=new Date(); if(!store.days[dkey(d)]) d.setDate(d.getDate()-1);
  while(store.days[dkey(d)]){ n++; d.setDate(d.getDate()-1); }
  $("#st-streak").textContent = n;
}
function markPracticed(id){ const k = dkey(new Date()), a = store.practiced[k] || (store.practiced[k] = []); if(!a.includes(id)) a.push(id); saveStore(); updateReviewBanner(); }
const DB = new Promise((res, rej) => {
  const r = indexedDB.open("yueApp", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("rec", {keyPath:"id", autoIncrement:true});
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function dbDo(mode, fn){ const db = await DB; return new Promise((res, rej) => { const tx = db.transaction("rec", mode); const q = fn(tx.objectStore("rec")); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
const dbAdd = o => dbDo("readwrite", s => s.add(o));
const dbGet = id => dbDo("readonly", s => s.get(id));
const dbAll = () => dbDo("readonly", s => s.getAll());
const dbDel = id => dbDo("readwrite", s => s.delete(id));
const dbClear = () => dbDo("readwrite", s => s.clear());

/* ---------- the phone's Cantonese voice ---------- */
let yueVoice = null;
function findVoice(){
  if(!window.speechSynthesis) return null;
  const vs = speechSynthesis.getVoices();
  return vs.find(v => /^(zh[-_]HK|yue)/i.test(v.lang)) || vs.find(v => /cantonese|粤|粵|廣東|广东|hong kong|香港/i.test(v.name)) || null;
}
function renderVoiceCard(){
  yueVoice = findVoice();
  const c = $("#voice-card");
  if(yueVoice){ c.hidden = true; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  c.hidden = false;
  c.innerHTML = `<span class="lab">部手机未有粤语把声</span>
    <p class="small">要装咗粤语语音先可以读出嚟（一次过，免费）：</p>
    ${ios ? `<ol class="small"><li>打开「设定」→「辅助使用」→「朗读内容」→「声音」</li><li>拣「中文」→「中文（香港）」，下载一把声（例如 Sinji）</li><li>返嚟呢度重新打开</li></ol>`
          : `<ol class="small"><li>打开「设定」，搜寻「文字转语音」</li><li>引擎拣「Google 语音服务」→ 安装语音数据 →「粤语（香港）」</li><li>冇 Google 嘅手机：喺应用商店装「Google 语音服务」或者用 Edge 浏览器</li><li>返嚟呢度重新打开</li></ol>`}
    <p class="small">未装都可以照用：睇字同粤拼、录音、听返自己把声。</p>`;
}
if(window.speechSynthesis){ speechSynthesis.onvoiceschanged = renderVoiceCard; }
function say(text, rate){
  return new Promise(res => {
    if(!window.speechSynthesis){ res(); return; }
    stopAudio();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = yueVoice ? yueVoice.lang : "zh-HK"; if(yueVoice) u.voice = yueVoice;
    u.rate = rate || store.rate; u.onend = res; u.onerror = res;
    speechSynthesis.speak(u);
  });
}
let player = null;
function stopAudio(){ if(player){ player.pause(); player = null; } if(window.speechSynthesis) speechSynthesis.cancel(); }
function playBlob(blob){
  return new Promise(res => { stopAudio(); const url = URL.createObjectURL(blob); const a = new Audio(url); player = a;
    a.onended = () => { URL.revokeObjectURL(url); res(); }; a.onerror = res; a.play().catch(res); });
}
async function playRec(id){ const r = await dbGet(+id); if(r && r.audio) await playBlob(r.audio); }
async function compareRec(id){ const r = await dbGet(+id); if(!r) return; const it = ITEMS[r.item]; if(it) await say(spoken(it)); await new Promise(x=>setTimeout(x,400)); if(r.audio) await playBlob(r.audio); }

/* ---------- recording ---------- */
let active = null;
async function startRecording(){
  const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}});
  const type = ["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const chunks = [], mr = new MediaRecorder(stream, type ? {mimeType:type} : undefined);
  mr.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
  mr.start();
  return { stop: () => new Promise(res => { mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, {type: mr.mimeType || type || "audio/mp4"})); }; mr.stop(); }) };
}
function micError(e){
  if(!navigator.mediaDevices) return "要用 https 网址打开先可以录音。";
  return e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "未俾咪高峰权限。去手机设定开返浏览器嘅咪高峰，再试过。" : "咪高峰开唔到，再试一次。";
}
async function toggleRecord(btn, itemId, liveEl, onSaved){
  if(active){
    if(active.button !== btn) return;
    const a = active; active = null; btn.classList.remove("recording"); btn.textContent = a.label; liveEl.textContent = "";
    const blob = await a.ctl.stop();
    const id = await dbAdd({t: Date.now(), item:itemId, audio: blob});
    logRep(); markPracticed(itemId); onSaved(id); return;
  }
  try {
    stopAudio();
    const ctl = await startRecording();
    active = {ctl, button:btn, label:btn.textContent}; btn.classList.add("recording"); btn.textContent = "■ 停";
    liveEl.textContent = "录紧音…讲完撳「停」。";
  } catch(e){ liveEl.textContent = micError(e); }
}
const playRow = id => `<div class="row"><button data-playrec="${id}">▶ 我把声</button><button data-sayrec="${id}">▶ 原声</button><button class="primary" data-compare="${id}">对比</button></div>`;

/* ---------- practice card ---------- */
const state = {tab:"practice", topic: store.topic || "mix", sets:{}, idx:{}};
const sel = $("#topic");
sel.innerHTML = `<option value="mix">${LABEL.mix}</option>` + TOPICS.map(([k,l]) => `<option value="${k}">${esc(l)}</option>`).join("");
if(!LABEL[state.topic]) state.topic = "mix"; sel.value = state.topic;
sel.addEventListener("change", e => { state.topic = e.target.value; store.topic = state.topic; saveStore(); renderCard(); });
function setFor(t){ if(!state.sets[t]){ state.sets[t] = shuffle(byTopic(t)); state.idx[t] = 0; } return state.sets[t]; }
function curItem(){ const s = setFor(state.topic); return ITEMS[s[state.idx[state.topic] % s.length]]; }
function renderCard(revealed){
  const it = curItem(), s = setFor(state.topic), jpCls = store.showJp ? "jp" : "jp hide";
  $("#card").innerHTML = `<div class="meta"><span>${esc(LABEL[it.topic])}</span><span>${(state.idx[state.topic]%s.length)+1} / ${s.length}</span></div>
    <p class="yue">${esc(it.text)}${it.a ? "——" : ""}</p><p class="${jpCls}">${esc(it.jp)}</p>
    ${it.a ? (revealed ? `<div class="second"><p class="yue">${esc(it.a)}</p><p class="${jpCls}">${esc(it.ajp)}</p><p class="explain">${esc(it.ex)}</p></div>`
                       : `<button class="wide" id="reveal">揭晓下句</button>`) : ""}
    <div class="row big"><button class="primary" id="c-play">▶ 听</button><button id="c-slow">慢啲</button><button id="c-next">下一句 ›</button></div>
    <div class="row"><button id="c-jp">${store.showJp ? "收埋粤拼" : "显示粤拼"}</button><button id="c-prev">‹ 上一句</button></div>`;
  $("#prac").innerHTML = `<div class="row big"><button class="primary" id="p-play">▶ 听原声</button><button class="rec" id="p-rec">● 录音</button></div><p class="plive" id="p-live"></p><div class="presult" id="p-result"></div>`;
  const r = $("#reveal"); if(r) r.onclick = () => { renderCard(true); say(spoken(it)); };
  $("#c-play").onclick = () => say(it.a && !revealed ? it.text : spoken(it));
  $("#c-slow").onclick = () => say(it.a && !revealed ? it.text : spoken(it), 0.65);
  $("#c-next").onclick = () => { state.idx[state.topic]++; renderCard(); };
  $("#c-prev").onclick = () => { state.idx[state.topic] = Math.max(0, state.idx[state.topic]-1); renderCard(); };
  $("#c-jp").onclick = () => { store.showJp = !store.showJp; saveStore(); renderCard(revealed); };
  $("#p-play").onclick = () => say(spoken(it));
  $("#p-rec").onclick = () => toggleRecord($("#p-rec"), it.id, $("#p-live"), id => {
    const box = $("#p-result");
    box.insertAdjacentHTML("afterbegin", `<div class="attempt"><p class="small">录低咗。听下同原声有咩唔同？</p>${playRow(id)}</div>`);
    [...box.children].slice(4).forEach(x => x.remove());
  });
}

/* ---------- daily review: hear only → say it → reveal ---------- */
function lastPracticeDay(){ const today = dkey(new Date()); const ds = Object.keys(store.practiced).filter(d => d < today && store.practiced[d].length).sort(); return ds[ds.length-1] || null; }
function dayLabel(day){ const y = new Date(); y.setDate(y.getDate()-1); if(day === dkey(new Date())) return "今日"; if(day === dkey(y)) return "寻日"; const [Y,M,D] = day.split("-").map(Number); return `${M}月${D}日`; }
function updateReviewBanner(){
  const day = lastPracticeDay(), n = day ? store.practiced[day].length : 0, todo = day && !store.reviewed[day];
  const badge = $("#rv-badge"); badge.hidden = !todo; badge.textContent = n;
  const b = $("#rv-banner"); b.hidden = !todo; if(todo) b.textContent = `${dayLabel(day)}讲过 ${n} 句，嚟复习下 →`;
}
let rv = {day:null, list:[], i:0};
function setupReview(useToday){
  const today = dkey(new Date()), day = useToday ? today : lastPracticeDay(), list = day ? (store.practiced[day]||[]).filter(id => ITEMS[id]) : [];
  const todayCount = (store.practiced[today]||[]).length;
  $("#rv-today").hidden = useToday || !todayCount; $("#rv-summary").hidden = true;
  if(!list.length){
    $("#rv-card").hidden = true; $("#rv-pos").textContent = ""; $("#rv-day").textContent = ""; $("#rv-empty").hidden = false;
    $("#rv-empty").textContent = todayCount ? `今日讲过嘅 ${todayCount} 句，听日会喺呢度出现。想而家试就撳下面。` : "未有嘢复习。今日去「练习」录几句，听日就会喺度出现。";
    return;
  }
  if(!useToday && rv.day === day && rv.list.length === list.length && !$("#rv-card").hidden) return;
  rv = {day, list: shuffle(list), i:0};
  $("#rv-empty").hidden = true; $("#rv-day").textContent = `${dayLabel(day)}讲过嘅 ${list.length} 句`;
  renderReview();
}
function renderReview(){
  const it = ITEMS[rv.list[rv.i]];
  $("#rv-card").hidden = false; $("#rv-summary").hidden = true;
  $("#rv-pos").textContent = `${rv.i+1} / ${rv.list.length}`;
  $("#rv-answer").innerHTML = ""; $("#rv-result").innerHTML = ""; $("#rv-live").textContent = "";
  $("#rv-prev").disabled = rv.i === 0; $("#rv-next").textContent = rv.i === rv.list.length-1 ? "完成" : "下一句 ›";
}
const answerHtml = it => `<div class="sec"><span class="lab">答案</span><p class="yue">${esc(fullText(it))}</p><p class="jp">${esc(it.jp)}${it.ajp ? " — " + esc(it.ajp) : ""}</p>${it.ex ? `<p class="explain">${esc(it.ex)}</p>` : ""}</div>`;
$("#rv-play").onclick = () => say(spoken(ITEMS[rv.list[rv.i]]));
$("#rv-slow").onclick = () => say(spoken(ITEMS[rv.list[rv.i]]), 0.65);
$("#rv-show").onclick = () => { const it = ITEMS[rv.list[rv.i]]; $("#rv-answer").innerHTML = answerHtml(it); };
$("#rv-rec").onclick = () => { const it = ITEMS[rv.list[rv.i]];
  toggleRecord($("#rv-rec"), it.id, $("#rv-live"), id => { $("#rv-answer").innerHTML = answerHtml(it); $("#rv-result").innerHTML = `<div class="attempt"><p class="small">录低咗，对比下：</p>${playRow(id)}</div>`; }); };
$("#rv-prev").onclick = () => { if(rv.i > 0){ rv.i--; renderReview(); } };
$("#rv-next").onclick = () => {
  if(rv.i < rv.list.length-1){ rv.i++; renderReview(); return; }
  if(rv.day && rv.day !== dkey(new Date())){ store.reviewed[rv.day] = true; saveStore(); updateReviewBanner(); }
  $("#rv-card").hidden = true; $("#rv-pos").textContent = ""; $("#rv-summary").hidden = false;
  $("#rv-summary").innerHTML = `<p class="explain">复习完！讲得多就自然。</p><button id="rv-again" class="wide">再嚟一次</button>`;
  $("#rv-again").onclick = () => { rv.i = 0; rv.list = shuffle(rv.list); renderReview(); };
};
$("#rv-today").onclick = () => setupReview(true);

/* ---------- my recordings ---------- */
async function renderHistory(){
  let all = []; try { all = await dbAll(); } catch(e){}
  all.sort((a,b) => b.t - a.t);
  $("#hi-count").textContent = `${all.length} 段`;
  $("#hi-list").innerHTML = all.length ? all.slice(0, 200).map(h => { const it = ITEMS[h.item];
    return `<li class="hrow"><div class="top"><span>${esc(it ? LABEL[it.topic] : "")} · ${esc(new Date(h.t).toLocaleString("zh-HK", {month:"numeric", day:"numeric", hour:"numeric", minute:"2-digit"}))}</span></div>
      <div>${esc(it ? fullText(it) : "")}</div>${playRow(h.id)}<div class="row"><button data-del="${h.id}">删除</button></div></li>`; }).join("")
    : `<li class="small">未有录音。</li>`;
}

/* ---------- global taps ---------- */
document.addEventListener("click", async e => {
  const t = e.target;
  if(t.closest("[data-close]")){ closeSheet(); return; }
  const pr = t.closest("[data-playrec]"); if(pr){ playRec(pr.dataset.playrec); return; }
  const sr = t.closest("[data-sayrec]"); if(sr){ const r = await dbGet(+sr.dataset.sayrec); if(r && ITEMS[r.item]) say(spoken(ITEMS[r.item])); return; }
  const cp = t.closest("[data-compare]"); if(cp){ compareRec(cp.dataset.compare); return; }
  const del = t.closest("[data-del]"); if(del){ await dbDel(+del.dataset.del); renderHistory(); return; }
});

/* ---------- settings ---------- */
function closeSheet(){ $("#settings-sheet").hidden = true; $("#sheet-bg").hidden = true; }
$("#sheet-bg").onclick = closeSheet;
$("#open-settings").onclick = () => {
  $("#settings-sheet").innerHTML = `<div class="grab"></div><div class="sheet-head"><h2 id="set-title">设定</h2><button data-close>关闭</button></div>
    <div class="sec"><span class="lab">语速 <span id="rate-val">${store.rate.toFixed(2)}×</span></span>
      <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${store.rate}" aria-label="语速"></div>
    <div class="sec"><span class="lab">粤语把声</span><p class="small">${yueVoice ? `而家用紧：${esc(yueVoice.name)}` : "部手机未有粤语语音，睇上面嘅教学装一把。"}</p><button id="test-voice">试听</button></div>
    <div class="sec"><span class="lab">资料</span><p class="small">录音同进度只会存喺呢部手机。</p><button id="clear-all" class="wide">删除所有录音同进度</button></div>`;
  $("#settings-sheet").hidden = false; $("#sheet-bg").hidden = false;
  $("#rate").oninput = e => { store.rate = +e.target.value; $("#rate-val").textContent = store.rate.toFixed(2)+"×"; saveStore(); };
  $("#test-voice").onclick = () => say("早晨！今日食咗饭未呀？");
  let armed = false;
  $("#clear-all").onclick = async e => { if(!armed){ armed = true; e.currentTarget.textContent = "再撳一次确认删除"; return; }
    await dbClear(); store = {days:{}, practiced:{}, reviewed:{}, rate:store.rate, showJp:store.showJp}; saveStore(); renderStats(); updateReviewBanner(); closeSheet(); };
};

/* ---------- tabs, install, offline ---------- */
function showTab(t){
  if(!["practice","review","history"].includes(t)) t = "practice";
  state.tab = t;
  document.querySelectorAll(".tabbar a").forEach(a => { if(a.dataset.tab===t) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  ["practice","review","history"].forEach(x => $("#tab-"+x).hidden = x!==t);
  $(".topic").hidden = t !== "practice";
  if(t === "history") renderHistory();
  if(t === "review") setTimeout(() => setupReview(false), 0);
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
let deferredPrompt = null;
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
function renderInstall(){
  const c = $("#install-card");
  if(standalone || store.installDismissed){ c.hidden = true; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  c.hidden = false;
  c.innerHTML = `<span class="lab">加到主画面（可以唔加）</span>
    ${deferredPrompt ? `<button class="primary" id="do-install">安装</button>` : ios ? `<p class="small">Safari 下面撳「分享」→「加至主画面」。</p>` : `<p class="small">浏览器选单（⋮）→「安装应用程式」或「加到主画面」。</p>`}
    <button id="hide-install">唔使住</button>`;
  const di = $("#do-install"); if(di) di.onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; c.hidden = true; };
  $("#hide-install").onclick = () => { store.installDismissed = true; saveStore(); c.hidden = true; };
}
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if(had && !reloaded){ reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(()=>{});
}

renderStats(); renderVoiceCard(); setTimeout(renderVoiceCard, 1200); renderCard(); updateReviewBanner(); renderInstall(); showTab(location.hash.slice(1));
