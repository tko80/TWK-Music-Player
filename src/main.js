import { registerPlugin } from '@capacitor/core';
import './style.css';

const MusicPlayer = registerPlugin('MusicPlayer');
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'twk_music_library_v1';
const FAVORITES_KEY = 'twk_music_favorites_v1';
function loadJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
let tracks = loadJSON(STORAGE_KEY, []);
let current = -1;
let isPlaying = false;
let isShuffle = false;
let repeat = false;
let favorites = new Set(loadJSON(FAVORITES_KEY, []));
function saveLibrary() { localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks)); }
function saveFavorites() { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); }

const fmt = (seconds=0) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2,'0')}`;
};
function render() {
  $('trackCount').textContent = `${tracks.length} ${tracks.length===1?'song':'songs'}`;
  $('empty').hidden = tracks.length > 0;
  $('tracks').innerHTML = tracks.map((t,i)=>`<li class="track ${i===current?'active':''}" data-index="${i}">
    <div class="track-art">♫</div><div class="track-info"><b>${escapeHtml(t.name)}</b><small>Local file · ${t.type || 'Audio'}</small></div>
    <button class="row-play" aria-label="Play">${i===current&&isPlaying?'Ⅱ':'▶'}</button></li>`).join('');
  $('songTitle').textContent = current>=0 ? tracks[current].name : 'Nothing playing';
  $('songSub').textContent = current>=0 ? 'On this iPhone' : 'Choose a song to begin';
  $('favorite').textContent = current>=0 && favorites.has(tracks[current].id) ? '♥' : '♡';
  $('play').textContent = isPlaying ? 'Ⅱ' : '▶';
}
function escapeHtml(s='') { return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function chooseFiles() {
  try {
    const result = await MusicPlayer.pickFiles();
    for (const item of (result.files || [])) {
      if (!tracks.some(t=>t.id===item.id)) tracks.push(item);
    }
    saveLibrary();
    render();
    if (current < 0 && tracks.length) playTrack(0);
  } catch(e) { alert(e?.message || 'Could not open the Files picker.'); }
}
async function playTrack(index) {
  if (!tracks.length) return;
  current = (index + tracks.length) % tracks.length;
  try {
    const playback = await MusicPlayer.play({id:tracks[current].id, title:tracks[current].name});
    isPlaying = true;
    updateProgress({
      currentTime: Number(playback?.currentTime) || 0,
      duration: Number(playback?.duration) || 0
    });
    render();
  } catch(e) { isPlaying=false; alert(e?.message || 'Unable to play this audio file.'); render(); }
}
async function togglePlay() {
  if (current < 0) { if(tracks.length) await playTrack(0); return; }
  if (isPlaying) { await MusicPlayer.pause(); isPlaying=false; }
  else { await MusicPlayer.resume(); isPlaying=true; }
  render();
}
$('addMusic').onclick = $('browse').onclick = $('emptyAdd').onclick = chooseFiles;
$('play').onclick = togglePlay;
$('previous').onclick = () => playTrack(current<=0 ? tracks.length-1 : current-1);
$('next').onclick = () => playTrack(current+1);
$('shuffle').onclick = () => { isShuffle=!isShuffle; $('shuffle').classList.toggle('selected',isShuffle); };
$('repeat').onclick = () => { repeat=!repeat; $('repeat').classList.toggle('selected',repeat); };
$('favorite').onclick = () => { if(current>=0){ const id=tracks[current].id; favorites.has(id)?favorites.delete(id):favorites.add(id); saveFavorites(); render(); } };
$('tracks').onclick = (e) => { const li=e.target.closest('[data-index]'); if(li) playTrack(Number(li.dataset.index)); };
MusicPlayer.addListener('playbackState', state => { isPlaying=!!state.playing; render(); });
let playbackDuration = 0;
let isSeeking = false;
function updateProgress(state = {}) {
  const currentTime = Math.max(0, Number(state.currentTime) || 0);
  const duration = Math.max(0, Number(state.duration) || 0);
  if (duration > 0) playbackDuration = duration;
  $('elapsed').textContent = fmt(currentTime);
  $('duration').textContent = fmt(duration || playbackDuration);
  if (!isSeeking) {
    $('seek').value = duration > 0
      ? String(Math.max(0, Math.min(1000, Math.round(currentTime / duration * 1000))))
      : '0';
  }
}
MusicPlayer.addListener('playbackProgress', updateProgress);
$('seek').onpointerdown = () => { isSeeking = true; };
$('seek').oninput = () => {
  const previewTime = playbackDuration * Number($('seek').value) / 1000;
  $('elapsed').textContent = fmt(previewTime);
};
async function finishSeeking() {
  if (!isSeeking) return;
  isSeeking = false;
  if (current >= 0 && playbackDuration > 0) {
    const fraction = Number($('seek').value) / 1000;
    await MusicPlayer.seek({fraction});
    updateProgress({currentTime: playbackDuration * fraction, duration: playbackDuration});
  }
}
$('seek').onchange = finishSeeking;
$('seek').onpointerup = finishSeeking;
$('seek').ontouchend = finishSeeking;
MusicPlayer.addListener('remoteNext', () => playTrack(current+1));
MusicPlayer.addListener('remotePrevious', () => playTrack(current<=0?tracks.length-1:current-1));
MusicPlayer.addListener('remotePlayPause', togglePlay);
render();
