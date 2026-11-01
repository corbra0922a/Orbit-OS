const $ = (id) => document.getElementById(id);
const taskFor = (win) => document.querySelector(`[data-task="${win.id}"]`);

/* windows */

let topZ = 10;

function raise(win) {
  win.style.zIndex = ++topZ;
  document.querySelectorAll("[data-task]").forEach((task) => {
    task.setAttribute("aria-pressed", String(task === taskFor(win) && win.dataset.state === "open"));
  });
}

// Windows animate out (260ms max, see style.css), then get hidden. Reopening mid-animation just flips the state back.
function setState(win, state) {
  if (win.dataset.state === state) return;
  win.dataset.state = state;
  win.classList.remove("closing", "minimizing");
  const task = taskFor(win);
  task.classList.toggle("running", state !== "closed");
  task.setAttribute("aria-pressed", "false");

  if (state === "open") {
    win.hidden = false;
    const frame = win.querySelector("iframe");
    if (frame && !frame.src) frame.src = frame.dataset.src;
    raise(win);
    return;
  }

  if (document.fullscreenElement === win) document.exitFullscreen();
  if (state === "minimized") {
    const from = win.getBoundingClientRect();
    const to = task.getBoundingClientRect();
    win.style.setProperty("--dx", `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
    win.style.setProperty("--dy", `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
    win.classList.add("minimizing");
  } else {
    win.classList.add("closing");
    win.dispatchEvent(new Event("window-close"));
  }

  setTimeout(() => {
    if (win.dataset.state === "open") return;
    win.hidden = true;
    win.classList.remove("closing", "minimizing");
    const frame = win.querySelector("iframe");
    if (frame && win.dataset.state === "closed") frame.removeAttribute("src");
  }, 260);
}

document.querySelectorAll(".window").forEach((win) => {
  win.addEventListener("pointerdown", () => raise(win));

  const bar = win.querySelector(".titlebar");
  let grab = null;
  bar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || document.fullscreenElement) return;
    const rect = win.getBoundingClientRect();
    win.style.translate = "none";
    win.style.left = `${rect.left}px`;
    win.style.top = `${rect.top}px`;
    grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener("pointermove", (event) => {
    if (!grab) return;
    win.style.left = `${Math.max(0, Math.min(innerWidth - win.offsetWidth, event.clientX - grab.x))}px`;
    win.style.top = `${Math.max(0, Math.min(innerHeight - 44 - 34, event.clientY - grab.y))}px`;
  });
  bar.addEventListener("pointerup", () => { grab = null; });
  bar.addEventListener("pointercancel", () => { grab = null; });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.open) setState($(button.dataset.open), "open");

  if (button.dataset.task) {
    const win = $(button.dataset.task);
    const onTop = win.dataset.state === "open" && Number(win.style.zIndex) === topZ;
    if (onTop) setState(win, "minimized");
    else if (win.dataset.state === "open") raise(win);
    else setState(win, "open");
  }

  const win = button.closest(".window");
  const action = button.dataset.action;
  if (!win || !action) return;
  if (action === "minimize") setState(win, "minimized");
  if (action === "close") setState(win, "closed");
  if (action === "home") win.querySelector("iframe").src = win.querySelector("iframe").dataset.src;
  if (action === "fullscreen") {
    const request = document.fullscreenElement ? document.exitFullscreen() : win.requestFullscreen();
    request.catch(() => { status.textContent = "fullscreen isn't available here"; });
  }
});

document.addEventListener("fullscreenchange", () => {
  document.querySelectorAll('[data-action="fullscreen"]').forEach((button) => {
    const full = document.fullscreenElement === button.closest(".window");
    button.setAttribute("aria-label", full ? "Exit fullscreen" : "Fullscreen");
    button.setAttribute("aria-pressed", String(full));
  });
});

const clock = $("clock");
function tick() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
tick();
setInterval(tick, 10000);

/* player */

const audio = $("audio");
const status = $("status");
const trackName = $("trackName");
const toggle = $("toggle");
const loopButton = $("loop");
const progress = $("progress");
const volume = $("volume");
const search = $("search");

const tracks = [
  "2008.mp3", "Meme.mp3", "Nope your too late i already died.mp3", "a-z niardica cover.mp3",
  "be ur man.mp3", "bipolar.mp3", "close my eyes.mp3", "comfort song 4 u.mp3",
  "drinking thinking of me.mp3", "elephant cage.mp3", "fake ur face.mp3", "give me hints.mp3",
  "glm.mp3", "im not alright.mp3", "im so blue for you.mp3", "isnt it obvious.mp3",
  "kiss her stpd face.mp3", "lost at the disco (feat. overtonight).mp3", "mirrors demo.mp3",
  "not enough (feat. she left me today) (sped up).mp3", "one big prison.mp3", "party.mp3",
  "r u kissin any1.mp3", "shotgun.mp3", "sorry i killed her.mp3", "stalk ur socials.mp3",
  "they'll post it online (slowed).mp3", "twenty four.mp3", "unhappy.mp3", "would u notice.mp3",
  "you are my friend.mp3"
].map((file) => ({ id: file, title: file.replace(/\.mp3$/i, "") }));

const loopModes = ["off", "one", "all"];
let loopMode = "off";
let current = null;
let blobUrl = null;

/* imported songs: blobs live in IndexedDB, the playlist order in localStorage */

const playlistKey = "music-player-imported-playlist-v1";
let dbPromise = null;

function songStore(mode, run) {
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("music-player-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("songs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise.then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("songs", mode);
    const request = run(tx.objectStore("songs"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  }));
}

function savePlaylist() {
  const imported = tracks.filter((t) => t.imported).map(({ id, title }) => ({ id, title }));
  try {
    localStorage.setItem(playlistKey, JSON.stringify(imported));
  } catch (error) {
    console.error(error);
    status.textContent = "couldn't save the playlist";
  }
}

async function restorePlaylist() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(playlistKey) || "[]");
  } catch {}
  if (!Array.isArray(saved)) return;

  let missing = 0;
  for (const item of saved) {
    if (typeof item?.id !== "string" || typeof item.title !== "string") continue;
    const record = await songStore("readonly", (s) => s.get(item.id)).catch(() => null);
    if (record?.blob) tracks.push({ id: item.id, title: item.title, imported: true });
    else missing++;
  }
  render();
  if (missing) status.textContent = `${missing} imported song${missing === 1 ? "" : "s"} went missing`;
}

async function importFiles(files) {
  for (const file of files) {
    if (!/\.(mp3|mp4)$/i.test(file.name)) {
      status.textContent = `skipped ${file.name}, not an mp3/mp4`;
      continue;
    }
    const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await songStore("readwrite", (s) => s.put({ id, blob: file }));
      tracks.push({ id, title: file.name.replace(/\.(mp3|mp4)$/i, ""), imported: true });
      savePlaylist();
      status.textContent = "saved to this browser";
    } catch (error) {
      console.error(error);
      status.textContent = "couldn't save that song (storage full?)";
    }
  }
  render();
}

async function removeTrack(track) {
  if (current === track) stop();
  tracks.splice(tracks.indexOf(track), 1);
  savePlaylist();
  render();
  await songStore("readwrite", (s) => s.delete(track.id)).catch(console.error);
}

/* playback */

function stop() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  current = null;
  trackName.textContent = "nothing playing";
  document.title = "orbit";
  status.textContent = "pick a song below";
  render();
  updateProgress();
}

async function play(track) {
  audio.pause();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  current = track;

  if (track.imported) {
    const record = await songStore("readonly", (s) => s.get(track.id)).catch(() => null);
    if (!record?.blob) {
      status.textContent = "that song isn't saved anymore";
      return;
    }
    blobUrl = URL.createObjectURL(record.blob);
  }

  audio.src = blobUrl || `assets/${encodeURIComponent(track.id)}`;
  trackName.textContent = track.title;
  document.title = `${track.title} · orbit`;
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title });
  render();
  audio.play().catch(() => { status.textContent = "press play to start"; });
}

function step(direction) {
  if (!tracks.length) return;
  if (!current) return play(tracks[0]);
  const next = tracks.indexOf(current) + direction;
  if (next >= 0 && next < tracks.length) return play(tracks[next]);
  if (loopMode === "all") return play(tracks[(next + tracks.length) % tracks.length]);
  return false;
}

function formatTime(time) {
  if (!Number.isFinite(time)) return "0:00";
  const s = Math.floor(time);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateProgress() {
  const canSeek = Number.isFinite(audio.duration) && audio.duration > 0;
  progress.disabled = !canSeek;
  progress.value = canSeek ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
  $("elapsed").textContent = formatTime(audio.currentTime);
  $("duration").textContent = formatTime(audio.duration);
  progress.setAttribute("aria-valuetext", `${formatTime(audio.currentTime)} of ${formatTime(audio.duration)}`);
}

/* lists */

function songItem(track) {
  const item = document.createElement("li");
  item.classList.toggle("current", track === current);
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "pick";
  pick.textContent = track.title;
  pick.addEventListener("click", () => play(track));
  item.append(pick);
  return item;
}

function render() {
  const queue = $("queue");
  queue.replaceChildren(...tracks.map((track) => {
    const item = songItem(track);
    if (track.imported) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${track.title}`);
      remove.addEventListener("click", () => removeTrack(track));
      item.append(remove);
    }
    return item;
  }));
  $("queueCount").textContent = tracks.length;

  const query = search.value.trim().toLowerCase();
  const matches = tracks.filter((t) => t.title.toLowerCase().includes(query));
  const empty = document.createElement("li");
  empty.className = "empty";
  empty.textContent = "nothing matches";
  $("results").replaceChildren(...(matches.length ? matches.map(songItem) : [empty]));
}

/* events */

toggle.addEventListener("click", () => {
  if (!current) return step(1);
  if (audio.paused) audio.play().catch(() => { status.textContent = "can't play this file"; });
  else audio.pause();
});

$("prev").addEventListener("click", () => {
  if (audio.currentTime > 3) audio.currentTime = 0;
  else step(-1);
});
$("next").addEventListener("click", () => step(1));

loopButton.addEventListener("click", () => {
  loopMode = loopModes[(loopModes.indexOf(loopMode) + 1) % loopModes.length];
  audio.loop = loopMode === "one";
  loopButton.textContent = `loop ${loopMode}`;
  loopButton.classList.toggle("on", loopMode !== "off");
});

volume.addEventListener("input", () => {
  audio.volume = volume.value / 100;
  $("volumeValue").textContent = volume.value;
});

progress.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (progress.value / 1000) * audio.duration;
});

$("file").addEventListener("change", async (event) => {
  await importFiles([...event.target.files]);
  event.target.value = "";
});

search.addEventListener("input", render);
search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("results").querySelector(".pick")?.click();
});

$("player").addEventListener("window-close", stop);

audio.addEventListener("play", () => {
  toggle.textContent = "pause";
  toggle.setAttribute("aria-pressed", "true");
  status.textContent = "playing";
});
audio.addEventListener("pause", () => {
  toggle.textContent = "play";
  toggle.setAttribute("aria-pressed", "false");
  if (current && !audio.ended) status.textContent = "paused";
});
audio.addEventListener("ended", () => {
  if (step(1) === false) status.textContent = "end of queue";
});
audio.addEventListener("error", () => {
  if (audio.hasAttribute("src")) status.textContent = "couldn't load this file";
});
["loadedmetadata", "durationchange", "timeupdate", "emptied"].forEach((type) => audio.addEventListener(type, updateProgress));

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => toggle.click());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => $("prev").click());
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
}

window.addEventListener("beforeunload", () => blobUrl && URL.revokeObjectURL(blobUrl));

audio.volume = volume.value / 100;
raise($("player"));
render();
restorePlaylist().catch(() => { status.textContent = "couldn't restore imported songs"; });
