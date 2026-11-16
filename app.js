/* Speaking Studio: offline phone app. No Claude, no Google, no external servers.
   Content (sentences, meanings, Chinese, word glosses) and American audio are bundled.
   Scoring runs Whisper on the phone in a Web Worker. Your voice recordings stay in IndexedDB on the phone. */
"use strict";
var FATAL_TEXT = "Something went wrong on this phone's browser. Please screenshot this and send it to the developer";
/* ---------- safety net for older / in-app Android browsers ---------- */
if(!Array.prototype.flatMap) Array.prototype.flatMap = function(f, t){ return [].concat.apply([], this.map(f, t)); };
if(!Object.fromEntries) Object.fromEntries = function(it){ var o = {}; Array.from(it).forEach(function(p){ o[p[0]] = p[1]; }); return o; };
function showFatal(msg){
  var b = document.getElementById("fatal");
  if(!b){ b = document.createElement("div"); b.id = "fatal"; b.className = "fatal"; document.body.insertBefore(b, document.body.firstChild); }
  b.textContent = FATAL_TEXT + " (" + msg + ")";
}
window.addEventListener("error", function(e){ if(e && e.message) showFatal(e.message); });
var toastT = null;
function toast(msg, ms){
  var t = document.getElementById("toast");
  if(!t){ t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastT);
  if(ms) toastT = setTimeout(function(){ t.hidden = true; }, ms);
}
function hideToast(){ var t = document.getElementById("toast"); if(t) t.hidden = true; clearTimeout(toastT); }
var IN_APP = /MicroMessenger|QQ\/|MQQBrowser.*QQ|Weibo|DingTalk|AlipayClient|XiaoHongShu|aweme|Douyin/i.test(navigator.userAgent);

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };

/* ---------- content ---------- */
const { S, D, IDS, MIDS = {} } = window.DATA;     // S: topics, D: word dictionary, IDS: sentence -> audio id, MIDS: meaning line -> audio id
const INFO = {}, BANK = {}, LABEL = {}, ALL_DAILY = [];
Object.entries(S).forEach(([k,[label,rows]]) => {
  LABEL[k] = label; BANK[k] = rows.map(r => r[0]);
  rows.forEach(r => { INFO[r[0]] = {zh:r[1], en:r[2], where:r[3], phrases:r[4], sounds:r[5]}; if(k.startsWith("d-")) ALL_DAILY.push(r[0]); });
});
BANK["d-mix"] = ALL_DAILY; LABEL["d-mix"] = "Daily life mix (all scenarios)";

/* ---------- text comparison ---------- */
const UNITS = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
const TENS = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const SWAP = {gonna:"going to",wanna:"want to",gotta:"got to",kinda:"kind of",lemme:"let me",ok:"okay",yeah:"yes",yep:"yes",oclock:"",mr:"mister",isle:"aisle"};
function norm(s){
  const raw = String(s).toLowerCase().replace(/[’‘']/g,"").replace(/\$/g," ").replace(/%/g," percent ")
    .replace(/(\d)[.:](\d)/g,"$1 $2").replace(/(\d),(\d)/g,"$1$2").replace(/-/g," ").replace(/[^a-z0-9 ]/g," ")
    .split(/\s+/).filter(Boolean).flatMap(w => (SWAP[w] !== undefined ? SWAP[w] : w).split(" ").filter(Boolean));
  const out = [];                                   // "twenty five" -> "25", "six" -> "6"
  for(let i=0;i<raw.length;i++){
    const w = raw[i];
    if(TENS[w] !== undefined){ const n = UNITS[raw[i+1]]; if(n && n<10){ out.push(String(TENS[w]+n)); i++; } else out.push(String(TENS[w])); }
    else if(UNITS[w] !== undefined) out.push(String(UNITS[w]));
    else out.push(w);
  }
  return out;
}
const gkey = w => String(w).toLowerCase().replace(/[’‘]/g,"'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,"");
function lcsMatch(a, b){
  const n=a.length, m=b.length, dp=Array.from({length:n+1},()=>new Int16Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j] = a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ma=new Set(), mb=new Set(); let i=0,j=0;
  while(i<n && j<m){ if(a[i]===b[j]){ma.add(i);mb.add(j);i++;j++;} else if(dp[i+1][j]>=dp[i][j+1]) i++; else j++; }
  return {ma, mb};
}
function compare(target, said){
  const disp = target.split(/\s+/).filter(Boolean), units = [];
  disp.forEach((t,di) => norm(t).forEach(w => units.push({w, di})));
  const saidW = norm(said), {ma, mb} = lcsMatch(units.map(u=>u.w), saidW);
  const hit = disp.map(()=>true); units.forEach((u,k) => { if(!ma.has(k)) hit[u.di] = false; });
  return {disp, hit, score: units.length ? Math.round(100*ma.size/units.length) : 0,
          extras: saidW.filter((w,k)=>!mb.has(k)), missed: disp.filter((d,i)=>!hit[i]), said};
}
function lev(a, b){
  const d = Array.from({length:a.length+1}, (_,i) => [i]); for(let j=1;j<=b.length;j++) d[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
const sim = (a,b) => 1 - lev(a,b)/Math.max(a.length,b.length,1);
function scoreWord(target, said){
  const t = norm(target).join(" "), ws = norm(said);
  if(!ws.length) return {score:0, heard:""};
  if((" "+ws.join(" ")+" ").includes(" "+t+" ")) return {score:100, heard:t};
  let best = 0, heard = ws[0];
  ws.forEach(w => { const s = sim(w,t); if(s > best){ best = s; heard = w; } });
  return {score: Math.max(0, Math.round(best*100)), heard};
}
const scoreClass = s => s>=90?"good":s>=70?"mid":"low";

/* ---------- pronunciation tips (rules for Chinese speakers; no AI needed) ---------- */
const FUNC = new Set(["a","an","the","to","of","and","for","in","on","at","is","are","was","it","you","i","can","do","or","be","that","with"]);
function tipFor(word, heard){
  const w = gkey(word).replace(/'/g,""), h = (heard||"").replace(/'/g,"");
  const say = D[gkey(word)] ? D[gkey(word)][2] : "";
  const tips = [];
  if(!h){
    if(FUNC.has(w)) tips.push(`Small words like "${w}" get reduced in fast speech, but they still need a quick sound. Don't skip it.`);
    else tips.push("This word didn't come through at all. Say it a little slower and a little louder.");
  } else {
    const endC = /[bcdfgklmnpstvxz]$/.test(w);
    if(/ed$/.test(w) && !/ed$|d$|t$/.test(h)) tips.push(`The -ed ending was lost. After p, k, s, ch, sh, f say it as /t/ ("checked" → "checkt"); after t or d say /id/; otherwise /d/.`);
    else if(/s$/.test(w) && !/s$|z$/.test(h) && h.length >= w.length-2) tips.push(`The final -s was lost. Finish with a clear /s/ or /z/ sound.`);
    else if(endC && h.length < w.length && w.startsWith(h.slice(0, Math.max(2, h.length-1)))) tips.push(`The last sound was dropped. Chinese speakers often cut final consonants; finish the "${w.slice(-1)}" at the end.`);
    if(/th/.test(w) && !/th/.test(h)) tips.push(`"th": put your tongue lightly between your teeth and blow air. It shouldn't sound like s, z, d or f.`);
    if(/l/.test(w) && !/l/.test(h) && /r/.test(h)) tips.push(`Sounded like an "r" instead of "l". For /l/, touch the tip of your tongue behind your top teeth.`);
    if(/r/.test(w) && !/r/.test(h) && /l/.test(h)) tips.push(`Sounded like an "l" instead of "r". For /r/, curl your tongue back and don't touch the roof of your mouth.`);
    if(/v/.test(w) && !/v/.test(h) && /w|b/.test(h)) tips.push(`"v": touch your top teeth to your bottom lip and buzz. It shouldn't sound like w or b.`);
    if(/ng$/.test(w) && /n$/.test(h) && !/ng$/.test(h)) tips.push(`End with "ng" (back of the tongue up), not "n".`);
    if(/n$/.test(w) && /ng$/.test(h)) tips.push(`End with "n" (tongue tip up), not "ng".`);
    if(/[^e]i[^aeiou]/.test(w) && /ee|ea/.test(h)) tips.push(`Short "i" (as in "ship") was too long, like "sheep". Make it short and relaxed.`);
    if(/ee|ea/.test(w) && !/ee|ea/.test(h) && /i/.test(h)) tips.push(`Long "ee" (as in "sheep") was too short. Stretch it a little.`);
  }
  if(!tips.length) tips.push(`It came through as "${h}". Listen to the correct version and copy it closely.`);
  if(say && /[A-Z]/.test(say) && say.includes("-")) tips.push(`Stress: ${say}. Say the CAPS part louder and longer.`);
  return tips;
}
function tipsHtml(target, said, missed, extras){
  if(missed.length > 3 && missed.length / Math.max(1, target.split(/\s+/).length) > 0.7)
    return `<div class="sec"><span class="lab">Tip</span><p class="small">Most of the sentence didn't match. Hold the phone closer, speak a little slower, and try one half of the sentence at a time. Tap Compare to hear the difference.</p></div>`;
  const items = [];
  const pool = extras.slice();
  missed.slice(0, 4).forEach(m => {
    const k = gkey(m).replace(/'/g,"");
    let best = "", bs = 0.45; pool.forEach(x => { const s = sim(x, k); if(s > bs){ bs = s; best = x; } });
    if(best) pool.splice(pool.indexOf(best), 1);
    items.push(`<li><button class="w miss" data-drill="${esc(gkey(m))}">${esc(gkey(m))}</button>${best ? ` heard as <i>${esc(best)}</i>` : ""}
      <ul class="plain">${tipFor(m, best).map(t => `<li>${esc(t)}</li>`).join("")}</ul></li>`);
  });
  const info = INFO[target];
  if(!items.length) return "";
  return `<div class="sec"><span class="lab">Fix your pronunciation</span><ul class="tips">${items.join("")}</ul>
    ${info && info.sounds ? `<p class="small">Linking tip: <span class="snd">${esc(info.sounds)}</span></p>` : ""}
    <p class="small">Tap a red word to practice it on its own.</p></div>`;
}

/* ---------- storage ---------- */
const SKEY = "speakingStudioApp.v1";
let store; try { store = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch(e){ store = {}; }
store.days = store.days || {}; store.practiced = store.practiced || {}; store.reviewed = store.reviewed || {}; store.weak = store.weak || {};
store.voice = store.voice || "f"; store.rate = store.rate || 1;
const saveStore = () => { try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch(e){} };
const dkey = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function logRep(acc){
  const k = dkey(new Date()), d = store.days[k] || (store.days[k] = {reps:0, accSum:0, accN:0});
  d.reps++; if(acc!=null){ d.accSum+=acc; d.accN++; } saveStore(); renderStats();
}
function renderStats(){
  const t = store.days[dkey(new Date())]; $("#st-reps").textContent = t ? t.reps : 0;
  let n=0; const d=new Date(); if(!store.days[dkey(d)]) d.setDate(d.getDate()-1);
  while(store.days[dkey(d)]){ n++; d.setDate(d.getDate()-1); }
  $("#st-streak").textContent = n;
}
function addWeak(words, ctx){
  words.forEach(w => { const k = gkey(w); if(!k || k.length < 2) return;
    const e = store.weak[k] || (store.weak[k] = {miss:0, best:0}); e.miss++; e.ctx = ctx; });
  saveStore();
}
function markPracticed(s){ const k = dkey(new Date()), a = store.practiced[k] || (store.practiced[k] = []); if(!a.includes(s)) a.push(s); saveStore(); updateReviewBanner(); }

const DB = new Promise((res, rej) => {
  const r = indexedDB.open("speakingStudioApp", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("rec", {keyPath:"id", autoIncrement:true});
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function dbDo(mode, fn){ const db = await DB; return new Promise((res, rej) => { const tx = db.transaction("rec", mode); const q = fn(tx.objectStore("rec")); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
const dbAdd = o => dbDo("readwrite", s => s.add(o));
const dbPut = o => dbDo("readwrite", s => s.put(o));
const dbGet = id => dbDo("readonly", s => s.get(id));
const dbAll = () => dbDo("readonly", s => s.getAll());
const dbDel = id => dbDo("readwrite", s => s.delete(id));
const dbClear = () => dbDo("readwrite", s => s.clear());

/* ---------- audio playback (bundled American voices) ---------- */
let player = null, playerUrl = null;
function stopAudio(){ if(player){ player.pause(); player = null; } if(playerUrl){ URL.revokeObjectURL(playerUrl); playerUrl = null; } if(window.speechSynthesis) speechSynthesis.cancel(); }
function playSrc(src, rate){
  return new Promise(res => {
    stopAudio();
    const a = new Audio(src); a.playbackRate = rate || 1; a.preservesPitch = true; a.webkitPreservesPitch = true;
    // show that the tap worked while audio downloads; explain if it never arrives
    const slow = setTimeout(() => toast("Loading audio…"), 350);
    const fail = setTimeout(() => toast("The audio didn't load. Your connection may be slow; tap again in a moment.", 5000), 10000);
    const done = () => { clearTimeout(slow); clearTimeout(fail); };
    a.onplaying = () => { done(); hideToast(); };
    a.onended = () => { done(); res(); };
    a.onerror = () => { done(); toast("The audio couldn't play. Check your connection and try again.", 4000); res(); };
    player = a; a.play().catch(() => { done(); res(); });
  });
}
const wid = w => gkey(w).replace(/[^a-z0-9]/g, "_");
function speakFallback(text, rate){
  return new Promise(res => {
    if(!window.speechSynthesis) return res();
    const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = rate || 1;
    const v = speechSynthesis.getVoices().find(v => /^en[-_]US/i.test(v.lang)); if(v) u.voice = v;
    u.onend = res; u.onerror = res; stopAudio(); speechSynthesis.speak(u);
  });
}
function say(text, rate){
  rate = rate || store.rate;
  if(IDS[text]) return playSrc(`audio/${store.voice}/${IDS[text]}.mp3`, rate);
  if(MIDS[text]) return playSrc(`audio/e/${MIDS[text]}.mp3`, rate);
  if(D[gkey(text)] && !/\s/.test(text.trim())) return playSrc(`audio/w/${wid(text)}.mp3`, rate);
  return speakFallback(text, rate);
}
const canSpeakAny = () => !!window.speechSynthesis;
async function playBlob(blob){
  stopAudio(); playerUrl = URL.createObjectURL(blob);
  return playSrc(playerUrl, 1);
}
async function playRec(id){ const r = await dbGet(+id); if(r && r.audio){ const url = URL.createObjectURL(r.audio); await playSrc(url, 1); URL.revokeObjectURL(url); } }
async function compareRec(id){ const r = await dbGet(+id); if(!r) return; await say(r.target); await new Promise(x=>setTimeout(x,350)); if(r.audio){ const url = URL.createObjectURL(r.audio); await playSrc(url, 1); URL.revokeObjectURL(url); } }

/* ---------- on-phone speech recognition (Whisper in a worker) ---------- */
let worker = null, modelState = "idle", reqId = 0; const pendingReq = {}; const progress = {};
function ensureModel(){
  if(worker) return;
  try { worker = new Worker("stt-worker.js", {type:"module"}); } catch(e){ modelState = "error"; renderModelCard("This phone's browser can't run the scoring model. Your voice is still saved, and Compare still works."); return; }
  modelState = "loading"; renderModelCard();
  worker.onmessage = e => {
    const m = e.data;
    if(m.type === "progress"){ progress[m.file] = [m.loaded, m.total]; renderModelCard(); }
    else if(m.type === "ready"){ modelState = "ready"; renderModelCard(); store.modelReady = true; saveStore(); }
    else if(m.type === "error"){ modelState = "error"; worker = null; renderModelCard("Couldn't load the scoring model: " + m.message + ". Check your connection and tap Retry."); }
    else if(m.type === "result" && pendingReq[m.id]){ pendingReq[m.id](m); delete pendingReq[m.id]; }
  };
  worker.postMessage({type:"load", model: store.model === "base" ? "Xenova/whisper-base.en" : "Xenova/whisper-tiny.en"});
}
function renderModelCard(err){
  const c = $("#model-card");
  if(modelState === "ready" || modelState === "idle"){ c.hidden = true; return; }
  c.hidden = false;
  if(err){ c.innerHTML = `<span class="lab">Scoring model</span><p class="small">${esc(err)}</p><button id="model-retry">Retry</button>`; $("#model-retry").onclick = () => { worker = null; ensureModel(); }; return; }
  const vals = Object.values(progress), loaded = vals.reduce((a,v)=>a+v[0],0), total = vals.reduce((a,v)=>a+v[1],0);
  const pct = total ? Math.round(100*loaded/total) : 0;
  c.innerHTML = `<span class="lab">Getting the scoring model ready</span>
    <p class="small">One-time download${total ? ` (${(total/1048576).toFixed(0)} MB)` : ""}. After this, scoring works offline. You can keep practicing; scores appear when it's ready.</p>
    <div class="progress"><div style="width:${pct}%"></div></div>`;
}
async function to16kMono(blob){
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC(); const audio = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)); ctx.close && ctx.close();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.ceil(audio.duration * 16000);
  const off = new OAC(1, len, 16000); const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
  const out = await off.startRendering(); return out.getChannelData(0);
}
async function transcribe(blob){
  ensureModel();
  if(!worker) return {text:"", error:"no model"};
  const audio = await to16kMono(blob);
  let sum = 0; for(let i=0;i<audio.length;i++) sum += audio[i]*audio[i];
  if(!audio.length || Math.sqrt(sum/audio.length) < 0.004) return {text:"", quiet:true};
  const id = ++reqId;
  return new Promise(res => { pendingReq[id] = res; worker.postMessage({type:"run", id, audio}, [audio.buffer]); });
}

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
  if(window.top !== window) return "The microphone is blocked in this preview. Open the app from its home-screen icon.";
  if(!navigator.mediaDevices) return "Recording needs the app opened over https (from its web address or home-screen icon).";
  return e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "Microphone access is off. Allow the microphone for this app in your phone's settings, then try again."
    : e && e.name === "NotFoundError" ? "No microphone found." : "The microphone didn't start. Try again.";
}
/* toggleRecord: first tap starts, second tap stops, saves your voice, then scores it on the phone */
async function toggleRecord(btn, target, mode, liveEl, onSaved, onScored){
  if(active){
    if(active.button !== btn) return;
    const a = active; active = null; btn.classList.remove("recording"); btn.textContent = a.label;
    const blob = await a.ctl.stop();
    const isWord = norm(target).length <= 1;
    const id = await dbAdd({t: Date.now(), mode: isWord ? "word" : mode, target, said: "", score: null, audio: blob});
    onSaved(id);
    liveEl.textContent = modelState === "ready" ? "Scoring…" : "Scoring… (first time: waiting for the model to finish downloading)";
    const res = await transcribe(blob);
    liveEl.textContent = "";
    const said = res.text || "";
    let o = {id, target, said, isWord, score:null, r:null, error: res.error, quiet: res.quiet};
    if(said){
      if(isWord){ const sw = scoreWord(target, said); o.score = sw.score; o.heard = sw.heard;
        const k = gkey(target), e = store.weak[k] || (sw.score < 100 ? (store.weak[k] = {miss:0, best:0, ctx:""}) : null);
        if(e){ if(sw.score < 100) e.miss++; e.best = Math.max(e.best||0, sw.score); saveStore(); } }
      else { o.r = compare(target, said); o.score = o.r.score; if(mode !== "review" && o.score >= 40) addWeak(o.r.missed, target); }
      logRep(o.score);
      const rec = await dbGet(id); if(rec){ rec.said = said; rec.score = o.score; await dbPut(rec); }
    }
    onScored(o);
    return;
  }
  if(active) return;
  try {
    ensureModel();
    const ctl = await startRecording();
    active = {ctl, button:btn, label:btn.textContent}; btn.classList.add("recording"); btn.textContent = "■ Stop";
    liveEl.textContent = "Recording… tap Stop when you finish.";
  } catch(e){ liveEl.textContent = micError(e); }
}

/* ---------- shared UI pieces ---------- */
function wordsHtml(r, clickable){
  return `<div class="words" data-ctx="${esc(r.disp.join(" "))}">${r.disp.map((d,i) => r.hit[i]
    ? `<button class="w hit" data-word="${esc(d)}">${esc(d)}</button>`
    : `<button class="w miss" data-word="${esc(d)}" data-missed="1">${esc(d)}</button>`).join(" ")}</div>`;
}
function tappableSentence(s){
  return `<div class="words" data-ctx="${esc(s)}">${s.split(/\s+/).map(w => `<button class="w tap" data-word="${esc(w)}">${esc(w)}</button>`).join(" ")}</div>`;
}
function meaningHtml(s){
  const m = INFO[s]; if(!m) return "";
  return `<div class="card"><span class="lab">Meaning</span>
    ${tappableSentence(m.en)}<div class="zh">${esc(m.zh)}</div>
    ${practiceUI(m.en, "sentence")}
    <p class="small">Who says it: ${esc(m.where)}</p>
    ${m.phrases && m.phrases.length ? `<div class="sec"><span class="lab">Key phrases</span><ul class="plain">${m.phrases.map(p => `<li>${canSpeakAny() ? `<button class="mini" data-speak="${esc(p[0])}">▶</button>` : ""}<b>${esc(p[0])}</b>: ${esc(p[1])} <span class="zh">${esc(p[2])}</span></li>`).join("")}</ul></div>` : ""}
    ${m.sounds ? `<div class="sec"><span class="lab">Sounds like</span><span class="snd">${esc(m.sounds)}</span></div>` : ""}
  </div>`;
}
function practiceUI(target, mode){
  return `<div class="prac" data-target="${esc(target)}" data-mode="${mode}">
    <div class="row big"><button class="primary" data-act="play">▶ Hear it</button><button data-act="slow">Slower</button><button class="rec" data-act="rec">● Record</button></div>
    <p class="plive"></p><div class="presult"></div></div>`;
}
function attemptShell(id){ return `<div class="attempt" data-att="${id}"><p class="small">Saved your voice.</p>${playRow(id)}</div>`; }
function playRow(id, target){ return `<div class="row"><button data-playrec="${id}">▶ My voice</button><button data-sayrec="${id}">▶ Correct</button><button class="primary" data-compare="${id}">Compare</button></div>`; }
function attemptBody(o){
  if(!o.said) return `<p class="small">${o.error && modelState==="error" ? "Scoring isn't available on this phone." : o.quiet ? "That recording was very quiet. Speak louder or hold the phone closer." : "No words were recognized. Speak a little louder and closer to the phone."} Use Compare to judge by ear.</p>`;
  if(o.isWord){
    const v = o.score===100 ? "Clear! Say it two more times, then use it in the sentence." : o.score>=70 ? "Close. Compare, then try again." : "It came through as a different word.";
    return `<div class="verdict"><span class="score sm ${scoreClass(o.score)}">${o.score}%</span><span>${v}</span></div>
      <p class="small">It heard: <b>${esc(o.said)}</b></p>${o.score<100 ? tipsHtml(o.target, o.said, [o.target], [o.heard||""]) : ""}`;
  }
  const v = o.score===100 ? "Every word came through." : o.score>=80 ? "Close. Red words weren't clear." : "Several words weren't clear. Compare, then try again.";
  return `<div class="verdict"><span class="score sm ${scoreClass(o.score)}">${o.score}%</span><span>${v}</span></div>${wordsHtml(o.r)}
    <p class="small">It heard: ${esc(o.said)}</p>${tipsHtml(o.target, o.said, o.r.missed, o.r.extras)}`;
}

/* ---------- sheets ---------- */
function openSheet(id){ document.querySelectorAll(".sheet").forEach(s => s.hidden = s.id !== id); $("#sheet-bg").hidden = false; }
async function closeSheets(){
  if(active && active.button.closest(".sheet")){ const a = active; active = null; await a.ctl.stop(); }
  document.querySelectorAll(".sheet").forEach(s => s.hidden = true); $("#sheet-bg").hidden = true;
  if(state.tab === "history") renderHistory();
}
$("#sheet-bg").onclick = closeSheets;
document.addEventListener("keydown", e => { if(e.key === "Escape") closeSheets(); });

function openWord(word, ctx){
  const k = gkey(word), g = D[k], info = INFO[ctx];
  const phrase = info && info.phrases ? info.phrases.find(p => p[0].toLowerCase().split(/\s+/).map(gkey).includes(k)) : null;
  $("#word-sheet").innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h2 id="ws-word">${esc(k)}</h2><button data-close>Close</button></div>
    ${g ? `<div class="row"><span class="snd">${esc(g[2])}</span><button class="mini" data-word-audio="${esc(k)}">▶ Hear it</button></div>
      <div>${esc(g[0])}</div><div class="zh">${esc(g[1])}</div>` : `<p class="small">No dictionary entry for this word.</p>`}
    ${phrase ? `<div class="sec"><span class="lab">In this sentence it's part of</span><div><b>${esc(phrase[0])}</b>: ${esc(phrase[1])} <span class="zh">${esc(phrase[2])}</span></div></div>` : ""}
    <button class="primary wide" data-drill="${esc(k)}" data-ctx2="${esc(ctx||"")}">Practice saying it</button>`;
  openSheet("word-sheet");
}
function openDrill(target, ctx){
  target = String(target).trim(); const isWord = norm(target).length <= 1; if(isWord) target = gkey(target) || target;
  const g = isWord ? D[gkey(target)] : null;
  $("#drill-sheet").innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><div><span class="lab">${isWord ? "Word practice" : "Sentence practice"}</span><h2 id="dr-title" class="${isWord?"":"long"}">${esc(target)}</h2></div><button data-close>Close</button></div>
    ${g ? `<p class="small"><span class="snd">${esc(g[2])}</span> · ${esc(g[0])} <span class="zh">${esc(g[1])}</span></p>` : ""}
    ${!isWord && INFO[target] ? `<p class="small zh">${esc(INFO[target].zh)}</p>` : ""}
    ${isWord && ctx ? `<p class="small">From: ${esc(ctx)}</p>` : ""}
    ${practiceUI(target, "sentence")}`;
  openSheet("drill-sheet");
}
function openSettings(){
  $("#settings-sheet").innerHTML = `<div class="grab"></div>
    <div class="sheet-head"><h2 id="set-title">Settings</h2><button data-close>Close</button></div>
    <div class="sec"><span class="lab">Voice</span><div class="row">
      <button id="v-f" class="${store.voice==="f"?"primary":""}">Female voice</button><button id="v-m" class="${store.voice==="m"?"primary":""}">Male voice</button></div></div>
    <div class="sec"><span class="lab">Speed <span id="rate-val">${store.rate.toFixed(2)}×</span></span>
      <input type="range" id="rate" min="0.7" max="1.2" step="0.05" value="${store.rate}" aria-label="Playback speed"></div>
    <div class="sec"><span class="lab">Scoring</span><div class="row">
      <button id="m-tiny" class="${store.model!=="base"?"primary":""}">Fast (41 MB)</button><button id="m-base" class="${store.model==="base"?"primary":""}">More accurate (77 MB)</button></div>
      <p class="small">More accurate catches fewer false mistakes on sentences, but takes about twice as long to score.</p></div>
    <div class="sec"><span class="lab">Offline</span><p class="small" id="off-status">Download all audio and the scoring model so the app works with no internet.</p>
      <button id="off-dl" class="wide">Download everything for offline use</button></div>
    <div class="sec"><span class="lab">Your data</span><p class="small">Recordings and progress are stored only on this phone.</p>
      <button id="clear-all" class="wide">Delete all recordings and progress</button></div>`;
  openSheet("settings-sheet");
  $("#v-f").onclick = () => { store.voice = "f"; saveStore(); openSettings(); say(cur()); };
  $("#v-m").onclick = () => { store.voice = "m"; saveStore(); openSettings(); say(cur()); };
  $("#rate").oninput = e => { store.rate = +e.target.value; $("#rate-val").textContent = store.rate.toFixed(2)+"×"; saveStore(); };
  $("#off-dl").onclick = downloadOffline;
  const setModel = m => { if((store.model||"tiny") === m) return; store.model = m; store.modelReady = false; saveStore();
    if(worker){ worker.terminate(); worker = null; } Object.keys(progress).forEach(k => delete progress[k]); modelState = "idle"; ensureModel(); openSettings(); };
  $("#m-tiny").onclick = () => setModel("tiny");
  $("#m-base").onclick = () => setModel("base");
  let armed = false;
  $("#clear-all").onclick = async e => {
    if(!armed){ armed = true; e.currentTarget.textContent = "Tap again to delete everything"; return; }
    await dbClear(); store = {days:{}, practiced:{}, reviewed:{}, weak:{}, voice:store.voice, rate:store.rate}; saveStore();
    renderStats(); updateReviewBanner(); closeSheets();
  };
}
$("#open-settings").onclick = openSettings;
async function downloadOffline(){
  const btn = $("#off-dl"), st = $("#off-status"); btn.disabled = true; ensureModel();
  if(!("caches" in window)){ st.textContent = "This browser can't store files for offline use."; return; }
  const urls = [];
  Object.values(IDS).forEach(id => { urls.push(`audio/f/${id}.mp3`, `audio/m/${id}.mp3`, `audio/e/${id}.mp3`); });
  Object.keys(D).forEach(w => urls.push(`audio/w/${wid(w)}.mp3`));
  const cache = await caches.open("ss-media-v1"); let done = 0;
  const queue = urls.slice(); const workers = Array.from({length:6}, async () => {
    while(queue.length){ const u = queue.shift(); try { if(!(await cache.match(u))){ const r = await fetch(u); if(r.ok) await cache.put(u, r); } } catch(e){} done++; if(done % 20 === 0 || done === urls.length) st.textContent = `Audio: ${done} of ${urls.length} files…`; }
  });
  await Promise.all(workers);
  st.textContent = modelState === "ready" ? "Everything is downloaded. The app now works offline." : "Audio downloaded. The scoring model is still downloading (see the progress card).";
  btn.disabled = false;
}

/* ---------- global taps ---------- */
document.addEventListener("click", async e => {
  const t = e.target;
  if(t.closest("[data-close]")){ closeSheets(); return; }
  const a = t.closest("[data-act]"); if(a){
    const blk = a.closest(".prac"), target = blk.dataset.target, act = a.dataset.act;
    if(act === "play") say(target);
    else if(act === "slow") say(target, 0.75);
    else if(act === "rec"){
      const box = blk.querySelector(".presult");
      toggleRecord(a, target, blk.dataset.mode, blk.querySelector(".plive"),
        id => { box.insertAdjacentHTML("afterbegin", attemptShell(id)); [...box.children].slice(4).forEach(x => x.remove()); },
        o => { const el = box.querySelector(`[data-att="${o.id}"]`); if(el) el.innerHTML = attemptBody(o) + playRow(o.id); });
    }
    return;
  }
  const dr = t.closest("[data-drill]"); if(dr){ const c = dr.closest("[data-ctx]"); openDrill(dr.dataset.drill, dr.dataset.ctx2 || (c ? c.dataset.ctx : "")); return; }
  const w = t.closest("[data-word]"); if(w){ const c = w.closest("[data-ctx]"); openWord(w.dataset.word, c ? c.dataset.ctx : ""); return; }
  const wa = t.closest("[data-word-audio]"); if(wa){ say(wa.dataset.wordAudio); return; }
  const sp = t.closest("[data-speak]"); if(sp){ say(sp.dataset.speak); return; }
  const sy = t.closest("[data-say]"); if(sy){ say(sy.dataset.say); return; }
  const pr = t.closest("[data-playrec]"); if(pr){ playRec(pr.dataset.playrec); return; }
  const sr = t.closest("[data-sayrec]"); if(sr){ const r = await dbGet(+sr.dataset.sayrec); if(r) say(r.target); return; }
  const cp = t.closest("[data-compare]"); if(cp){ compareRec(cp.dataset.compare); return; }
  const del = t.closest("[data-del]"); if(del){ await dbDel(+del.dataset.del); renderHistory(); return; }
});

/* ---------- hover pop-up on computers (phones use tap → bottom sheet) ---------- */
const canHover = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
if(canHover){
  const tip = document.createElement("div"); tip.id = "hover-tip"; tip.hidden = true; tip.setAttribute("role","tooltip"); document.body.appendChild(tip);
  let showT = null, hideT = null, tipFor = null;
  const place = el => { tip.hidden = false; const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, vw = document.documentElement.clientWidth;
    let left = Math.max(8, Math.min(r.left + r.width/2 - tw/2, vw - tw - 8)), top = r.top - th - 8; if(top < 8) top = r.bottom + 8;
    tip.style.left = (left + scrollX) + "px"; tip.style.top = (top + scrollY) + "px"; };
  const show = el => {
    const k = gkey(el.dataset.word), g = D[k], c = el.closest("[data-ctx]"), info = c ? INFO[c.dataset.ctx] : null;
    const phrase = info && info.phrases ? info.phrases.find(p => p[0].toLowerCase().split(/\s+/).map(gkey).includes(k)) : null;
    tip.innerHTML = `<div class="row"><b>${esc(k)}</b>${g ? `<span class="snd">${esc(g[2])}</span>` : ""}</div>
      ${g ? `<div>${esc(g[0])}</div><div class="zh">${esc(g[1])}</div>` : `<div class="small">No dictionary entry.</div>`}
      ${phrase ? `<div class="ph">Part of <b>${esc(phrase[0])}</b>: ${esc(phrase[1])} <span class="zh">${esc(phrase[2])}</span></div>` : ""}
      <div class="small">Click for audio and practice</div>`;
    tipFor = el; place(el);
  };
  document.addEventListener("mouseover", e => { const el = e.target.closest("[data-word]"); if(!el || el === tipFor) return; clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(() => show(el), 200); });
  document.addEventListener("mouseout", e => { if(!e.target.closest("[data-word]")) return; clearTimeout(showT); hideT = setTimeout(() => { tip.hidden = true; tipFor = null; }, 150); });
  document.addEventListener("click", () => { tip.hidden = true; tipFor = null; }, true);
}

/* ---------- tabs & topic ---------- */
const state = {tab:"listen", topic: store.topic || "d-mix", sets:{}, idx:{}};
const sel = $("#topic");
sel.innerHTML = `<optgroup label="Daily life in the US"><option value="d-mix">${esc(LABEL["d-mix"])}</option>${Object.keys(S).filter(k=>k.startsWith("d-")).map(k=>`<option value="${k}">${esc(LABEL[k])}</option>`).join("")}</optgroup>
  <optgroup label="Work &amp; career">${Object.keys(S).filter(k=>!k.startsWith("d-")).map(k=>`<option value="${k}">${esc(LABEL[k])}</option>`).join("")}</optgroup>`;
if(!BANK[state.topic]) state.topic = "d-mix";
sel.value = state.topic;
sel.addEventListener("change", e => { state.topic = e.target.value; store.topic = state.topic; saveStore(); refreshSentence(); });
function setFor(t){ if(!state.sets[t]){ state.sets[t] = shuffle(BANK[t]); state.idx[t] = 0; } return state.sets[t]; }
function cur(){ const s = setFor(state.topic); return s[state.idx[state.topic] % s.length]; }
function refreshSentence(){ const s = setFor(state.topic); $("#lis-pos").textContent = `${(state.idx[state.topic]%s.length)+1} of ${s.length}`; $("#lis-topic").textContent = LABEL[state.topic]; $("#lis-input").value = ""; $("#lis-result").innerHTML = ""; $("#lis-status").textContent = ""; }
function showTab(t){
  if(!["listen","review","history"].includes(t)) t = "listen";
  state.tab = t;
  document.querySelectorAll(".tabbar a").forEach(a => { if(a.dataset.tab===t) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  ["listen","review","history"].forEach(x => $("#tab-"+x).hidden = x!==t);
  $(".topic").hidden = t !== "listen";
  if(t === "history") renderHistory();
  if(t === "review") setupReview(false);
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

/* ---------- Listen & type ---------- */
$("#lis-play").onclick = () => say(cur());
$("#lis-slow").onclick = () => say(cur(), 0.75);
$("#lis-next").onclick = () => { state.idx[state.topic]++; refreshSentence(); say(cur()); };
function lisCheck(){
  const typed = $("#lis-input").value.trim();
  if(!typed){ $("#lis-status").textContent = "Type what you heard first."; return; }
  $("#lis-status").textContent = "";
  const s = cur(), r = compare(s, typed);
  const verdict = r.score===100 ? "Perfect." : r.score>=90 ? "Very close." : r.score>=70 ? "Good start. Replay slower and listen for the red words." : "Tough one. Replay it slowly a few times.";
  $("#lis-result").innerHTML = `<div class="card"><div class="verdict"><span class="score ${scoreClass(r.score)}">${r.score}%</span><span>${verdict}</span></div>
      ${wordsHtml(r)}<p class="small">${window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches ? "Hover over any word for its meaning; click for audio and practice." : "Tap any word for its meaning, audio and practice."}</p></div>
    ${meaningHtml(s)}
    <div class="card"><span class="lab">Now say it yourself</span>${practiceUI(s, "sentence")}</div>`;
  logRep(r.score); markPracticed(s);
  $("#lis-input").blur();
}
$("#lis-check").onclick = lisCheck;
$("#lis-input").addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); lisCheck(); } });

/* ---------- Daily review ---------- */
function lastPracticeDay(){ const today = dkey(new Date()); const ds = Object.keys(store.practiced).filter(d => d < today && store.practiced[d].length).sort(); return ds[ds.length-1] || null; }
function dayLabel(day){ const y = new Date(); y.setDate(y.getDate()-1); if(day === dkey(new Date())) return "today"; if(day === dkey(y)) return "yesterday"; const [Y,M,Dd] = day.split("-").map(Number); return new Date(Y,M-1,Dd).toLocaleDateString([], {weekday:"long", month:"short", day:"numeric"}); }
function updateReviewBanner(){
  const day = lastPracticeDay(), n = day ? store.practiced[day].length : 0, todo = day && !store.reviewed[day];
  const badge = $("#rv-badge"); badge.hidden = !todo; badge.textContent = n;
  const b = $("#rv-banner"); b.hidden = !todo;
  if(todo) b.textContent = `${n} sentence${n>1?"s":""} from ${dayLabel(day)} to review. Say them in English →`;
}
let rv = {day:null, list:[], i:0, scores:[]};
function setupReview(useToday){
  const today = dkey(new Date()), day = useToday ? today : lastPracticeDay(), list = day ? (store.practiced[day]||[]) : [];
  const todayCount = (store.practiced[today]||[]).length;
  $("#rv-today").hidden = useToday || !todayCount; $("#rv-summary").hidden = true;
  if(!list.length){
    $("#rv-card").hidden = true; $("#rv-pos").textContent = ""; $("#rv-day").textContent = ""; $("#rv-empty").hidden = false; $("#rv-result").innerHTML = "";
    $("#rv-empty").textContent = todayCount ? `The ${todayCount} sentence${todayCount>1?"s":""} you practiced today will show up here tomorrow in Chinese. Or tap below to try them now.`
      : "Nothing to review yet. Check some sentences in Listen today, and tomorrow they'll show up here in Chinese.";
    return;
  }
  if(!useToday && rv.day === day && rv.list.length === list.length && !$("#rv-card").hidden) return;
  rv = {day, list: shuffle(list), i:0, scores:[]};
  $("#rv-empty").hidden = true; $("#rv-day").textContent = `${list.length} sentence${list.length>1?"s":""} from ${dayLabel(day)}. See the Chinese, say the English.`;
  renderReviewCard();
}
function renderReviewCard(){
  const s = rv.list[rv.i];
  $("#rv-card").hidden = false; $("#rv-summary").hidden = true;
  $("#rv-pos").textContent = `${rv.i+1} of ${rv.list.length}`;
  $("#rv-zh").textContent = INFO[s] ? INFO[s].zh : s;
  $("#rv-result").innerHTML = ""; $("#rv-text").value = ""; $("#rv-live").textContent = "";
  $("#rv-prev").disabled = rv.i === 0; $("#rv-next").textContent = rv.i === rv.list.length-1 ? "Finish" : "Next ›";
}
const answerCard = s => `<div class="card"><span class="lab">Original</span>${tappableSentence(s)}${practiceUI(s, "sentence")}</div>`;
$("#rv-show").onclick = () => { const s = rv.list[rv.i]; if(!$("#rv-result .card")) $("#rv-result").innerHTML = answerCard(s) + meaningHtml(s); say(s); };
$("#rv-rec").onclick = () => {
  const s = rv.list[rv.i], btn = $("#rv-rec");
  toggleRecord(btn, s, "review", $("#rv-live"),
    id => { $("#rv-result").innerHTML = `<div class="card" data-att="${id}"><p class="small">Saved your voice.</p>${playRow(id)}</div>` + answerCard(s); },
    o => {
      if(o.score != null) rv.scores[rv.i] = o.score;
      const el = $(`#rv-result [data-att="${o.id}"]`); if(!el) return;
      el.innerHTML = (o.said ? `<div class="verdict"><span class="score ${scoreClass(o.score)}">${o.score}%</span><span>match with the original wording. Different wording can still be right; compare and decide.</span></div>${wordsHtml(o.r)}<p class="small">You said: ${esc(o.said)}</p>` : attemptBody(o)) + playRow(o.id);
    });
};
$("#rv-text").addEventListener("keydown", e => {
  if(e.key !== "Enter") return; e.preventDefault();
  const s = rv.list[rv.i], said = $("#rv-text").value.trim(); if(!said) return;
  const r = compare(s, said); rv.scores[rv.i] = r.score; logRep(r.score); $("#rv-text").blur();
  $("#rv-result").innerHTML = `<div class="card"><div class="verdict"><span class="score ${scoreClass(r.score)}">${r.score}%</span><span>match with the original wording</span></div>${wordsHtml(r)}</div>` + answerCard(s);
});
$("#rv-prev").onclick = () => { if(rv.i > 0){ rv.i--; renderReviewCard(); } };
$("#rv-next").onclick = () => {
  if(rv.i < rv.list.length-1){ rv.i++; renderReviewCard(); return; }
  if(rv.day && rv.day !== dkey(new Date())){ store.reviewed[rv.day] = true; saveStore(); updateReviewBanner(); }
  const done = rv.scores.filter(x => x != null), avg = done.length ? Math.round(done.reduce((a,b)=>a+b,0)/done.length) : null;
  const weak = rv.list.filter((s,i) => rv.scores[i] == null || rv.scores[i] < 80);
  $("#rv-card").hidden = true; $("#rv-pos").textContent = ""; $("#rv-result").innerHTML = ""; $("#rv-summary").hidden = false;
  $("#rv-summary").innerHTML = `<span class="lab">Review done</span>${avg != null ? `<div class="verdict"><span class="score ${scoreClass(avg)}">${avg}%</span><span>average across ${done.length} sentence${done.length>1?"s":""}</span></div>` : ""}
    ${weak.length ? `<span class="lab">Practice these again</span><ul class="plain">${weak.map(s => `<li>${esc(s)} <button class="mini" data-say="${esc(s)}">▶</button><button class="mini" data-drill="${esc(s)}">Practice</button></li>`).join("")}</ul>` : `<p>You got every sentence.</p>`}
    <button id="rv-again" class="wide">Go through them again</button>`;
  $("#rv-again").onclick = () => { rv.i = 0; rv.scores = []; rv.list = shuffle(rv.list); renderReviewCard(); };
};
$("#rv-today").onclick = () => setupReview(true);

/* ---------- Recordings ---------- */
const MODE_LABEL = {sentence:"Sentence", word:"Word", review:"Daily review"};
async function renderHistory(){
  const weak = Object.entries(store.weak).sort((a,b) => ((a[1].best===100) - (b[1].best===100)) || (b[1].miss - a[1].miss)).slice(0, 60);
  $("#hi-weak").innerHTML = weak.length ? weak.map(([k,e]) => `<button class="chip${e.best===100?" done":""}" data-drill="${esc(k)}" data-ctx2="${esc(e.ctx||"")}">${esc(k)}<span class="n">×${e.miss}</span>${e.best===100?" ✓":""}</button>`).join("") : `<p class="small">None yet.</p>`;
  let all = []; try { all = await dbAll(); } catch(e){}
  all.sort((a,b) => b.t - a.t);
  const f = $("#hi-filter").value, list = all.filter(h => f==="all" || h.mode===f);
  $("#hi-count").textContent = `${all.length} recordings`;
  $("#hi-list").innerHTML = list.length ? list.slice(0, 200).map(h => `<li class="hrow">
      <div class="top"><span>${MODE_LABEL[h.mode]||h.mode} · ${esc(new Date(h.t).toLocaleString([], {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}))}</span>${h.score!=null ? `<span class="score sm ${scoreClass(h.score)}">${h.score}%</span>` : ""}</div>
      <div>${esc(h.target)}</div>${h.mode==="review" && INFO[h.target] ? `<div class="small zh">${esc(INFO[h.target].zh)}</div>` : ""}
      <div class="small">It heard: ${esc(h.said || "(not scored)")}</div>
      <div class="row"><button data-playrec="${h.id}">▶ Mine</button><button data-say="${esc(h.target)}">▶ Correct</button><button class="primary" data-compare="${h.id}">Compare</button><button data-drill="${esc(h.target)}">Retry</button><button data-del="${h.id}" aria-label="Delete recording">Delete</button></div>
    </li>`).join("") : `<li class="small">No recordings yet.</li>`;
}
$("#hi-filter").addEventListener("change", renderHistory);

/* ---------- install prompt & offline ---------- */
let deferredPrompt = null;
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
function renderInstall(){
  const c = $("#install-card");
  if(IN_APP){   // WeChat / QQ / Xiaohongshu in-app browsers block recording and installing
    c.hidden = false; c.classList.add("inapp");
    c.innerHTML = `<span class="lab">Open in your browser</span>
      <p class="small">You're inside an app's built-in browser, where recording and installing don't work. Tap <b>···</b> at the top right, then <b>在浏览器打开 / Open in browser</b>.</p>`;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // Android: only show the card when the browser offers a real Install button (manual steps confused people)
  if(standalone || store.installDismissed || (!ios && !deferredPrompt)){ c.hidden = true; return; }
  c.hidden = false;
  c.innerHTML = `<span class="lab">Install the app</span>
    ${deferredPrompt ? `<p class="small">Add Speaking Studio to your home screen. It opens like a normal app and works offline.</p><button class="primary" id="do-install">Install</button>`
      : ios ? `<ol class="small"><li>Tap the <b>Share</b> button at the bottom of Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Open Speaking Studio from the new icon.</li></ol>`
      : `<ol class="small"><li>Open your browser's menu (⋮).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Open Speaking Studio from the new icon.</li></ol>`}
    <button id="hide-install">Not now</button>`;
  const di = $("#do-install"); if(di) di.onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; c.hidden = true; };
  $("#hide-install").onclick = () => { store.installDismissed = true; saveStore(); c.hidden = true; };
}
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  // When a new version is published, the new service worker takes over and the page reloads once to show it.
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if(hadController && !reloaded){ reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(()=>{});
}
if(store.modelReady) ensureModel();    // warm up the scoring model if it was downloaded before

/* ---------- start ---------- */
renderStats(); refreshSentence(); updateReviewBanner(); renderInstall(); showTab(location.hash.slice(1));
