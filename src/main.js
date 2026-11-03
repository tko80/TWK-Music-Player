import { registerPlugin, Capacitor } from '@capacitor/core';
import './style.css';

const MusicPlayer = registerPlugin('MusicPlayer');
const $ = id => document.getElementById(id);
const isNative = Capacitor.isNativePlatform();

const STORAGE_KEY = 'twk_music_library_v1';
const FAVORITES_KEY = 'twk_music_favorites_v1';
const PLAYLIST_KEY = 'twk_music_playlists_v1';

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

let tracks = loadJSON(STORAGE_KEY, []);
let favorites = new Set(loadJSON(FAVORITES_KEY, []));
let playlists = loadJSON(PLAYLIST_KEY, []);

let current = -1;
let isPlaying = false;
let isShuffle = false;
let repeat = false;
let activeTab = 'all';
let activePlaylist = null;
let selectedTracks = new Set();

let audio = null;
let playbackDuration = 0;
let isSeeking = false;

function saveLibrary() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(tracks.map(({ webUrl, ...track }) => track))
  );
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function savePlaylists() {
  localStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlists));
}

const fmt = seconds => {
  const n = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}


// TWK Music in-app dialogs (no browser-native "says" popups).
function ensureDialogStyles() {
  if (document.getElementById('twkDialogStyles')) return;
  const style = document.createElement('style');
  style.id = 'twkDialogStyles';
  style.textContent = `
    .twk-dialog-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
    .twk-dialog{width:min(100%,390px);padding:23px;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:#1b1a2b;color:#f6f7fb;box-shadow:0 24px 70px #000a}
    .twk-dialog h3{margin:0 0 9px;font-size:19px}
    .twk-dialog p{margin:0 0 17px;color:#aaaabd;font-size:13px;line-height:1.55;white-space:pre-line}
    .twk-dialog input{width:100%;padding:13px 14px;margin:0 0 18px;border:1px solid #ffffff2b;border-radius:12px;outline:none;background:#10101b;color:white;font:inherit}
    .twk-dialog input:focus{border-color:#a58bff}
    .twk-dialog-actions{display:flex;justify-content:flex-end;gap:9px}
    .twk-dialog-actions button{padding:11px 17px;border-radius:22px;background:#ffffff12;color:white;font-weight:600}
    .twk-dialog-actions .twk-dialog-primary{background:#9275ff;color:#15121e}
  `;
  document.head.appendChild(style);
}

function showMessage(message, title = 'TWK Music') {
  ensureDialogStyles();
  const backdrop = document.createElement('div');
  backdrop.className = 'twk-dialog-backdrop';
  backdrop.innerHTML = `<section class="twk-dialog" role="alertdialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="twk-dialog-actions"><button type="button" class="twk-dialog-primary">OK</button></div></section>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('button').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
}

function showConfirm(title, message) {
  ensureDialogStyles();
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'twk-dialog-backdrop';
    backdrop.innerHTML = `<section class="twk-dialog" role="alertdialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="twk-dialog-actions"><button type="button" class="twk-dialog-cancel">Cancel</button><button type="button" class="twk-dialog-primary">Delete</button></div></section>`;
    document.body.appendChild(backdrop);
    const finish = value => { backdrop.remove(); resolve(value); };
    backdrop.querySelector('.twk-dialog-cancel').addEventListener('click', () => finish(false));
    backdrop.querySelector('.twk-dialog-primary').addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(false); });
  });
}

async function deleteLibraryTrack(index) {
  const track = tracks[index];
  if (!track) return;

  const confirmed = await showConfirm(
    'Delete song?',
    `Remove “${track.name}” from your TWK Music library? This also removes it from Favorites and Playlists.`
  );
  if (!confirmed) return;

  if (track.webUrl) URL.revokeObjectURL(track.webUrl);

  if (index === current) {
    if (isNative) {
      try { await MusicPlayer.pause(); } catch (_) {}
    }
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio = null;
    }
    current = -1;
    isPlaying = false;
    playbackDuration = 0;
    updateProgress({ currentTime: 0, duration: 0 });
  } else if (index < current) {
    current--;
  }

  tracks.splice(index, 1);
  favorites.delete(track.id);
  selectedTracks.delete(track.id);
  playlists.forEach(playlist => {
    playlist.trackIds = playlist.trackIds.filter(id => id !== track.id);
  });

  saveLibrary();
  saveFavorites();
  savePlaylists();
  render();
  showMessage('Song removed from your TWK Music library. The original file in Files or iPhone Music is not deleted.');
}

function showPrompt(title, message, initialValue = '') {
  ensureDialogStyles();
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'twk-dialog-backdrop';
    backdrop.innerHTML = `<form class="twk-dialog" role="dialog" aria-modal="true"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><input type="text" autocomplete="off" value="${escapeHtml(initialValue)}"><div class="twk-dialog-actions"><button type="button" class="twk-dialog-cancel">Cancel</button><button type="submit" class="twk-dialog-primary">Save</button></div></form>`;
    document.body.appendChild(backdrop);
    const form = backdrop.querySelector('form');
    const input = form.querySelector('input');
    const finish = value => { backdrop.remove(); resolve(value); };
    form.addEventListener('submit', e => { e.preventDefault(); finish(input.value); });
    form.querySelector('.twk-dialog-cancel').addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(null); });
    input.focus();
    input.select();
  });
}

function getVisibleTracks() {
  if (activeTab === 'favorites') {
    return tracks.map((t, i) => ({ t, i }))
      .filter(x => favorites.has(x.t.id));
  }

  if (activeTab === 'playlists') {
    const playlist = playlists.find(p => p.id === activePlaylist);
    if (!playlist) return [];

    return playlist.trackIds
      .map(id => ({
        t: tracks.find(t => t.id === id),
        i: tracks.findIndex(t => t.id === id)
      }))
      .filter(x => x.i >= 0);
  }

  return tracks.map((t, i) => ({ t, i }));
}

function getQueueIndices() {
  return getVisibleTracks().map(item => item.i);
}

function moveTrack(direction, wrap = true) {
  const queue = getQueueIndices();

  if (!queue.length) return;

  let position = queue.indexOf(current);

  if (position < 0) {
    position = direction > 0 ? -1 : 0;
  }

  let nextPosition = position + direction;

  if (wrap) {
    nextPosition = (nextPosition + queue.length) % queue.length;
  } else if (
    nextPosition < 0 ||
    nextPosition >= queue.length
  ) {
    current = -1;
    isPlaying = false;

    if (audio) audio.pause();

    render();
    return;
  }

  playTrack(queue[nextPosition]);
}

function createTabs() {
  const head = document.querySelector('.library-head');
  let tabs = document.querySelector('.library-tabs') || document.getElementById('musicTabs');

  // Bind the visible tabs already present in index.html. Create a fallback only if absent.
  if (!tabs && head) {
    tabs = document.createElement('nav');
    tabs.id = 'musicTabs';
    tabs.className = 'music-tabs';
    tabs.innerHTML = `
      <button type="button" data-tab="all" class="active">All Songs</button>
      <button type="button" data-tab="favorites">Favorites</button>
      <button type="button" data-tab="playlists">Playlists</button>
    `;
    head.parentNode.insertBefore(tabs, head);
  }

  if (!tabs || tabs.dataset.twkTabsBound === 'true') return;
  tabs.dataset.twkTabsBound = 'true';

  const getTabName = button => {
    if (button.dataset.tab || button.dataset.view) return button.dataset.tab || button.dataset.view;
    const label = button.textContent.trim().toLowerCase();
    if (label.includes('favorite')) return 'favorites';
    if (label.includes('playlist')) return 'playlists';
    if (label.includes('all song')) return 'all';
    return null;
  };

  tabs.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || !tabs.contains(button)) return;
    const tabName = getTabName(button);
    if (!tabName) return;

    activeTab = tabName;
    activePlaylist = null;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
    render();
  });
}

async function createPlaylist() {
  const name = await showPrompt('Create playlist', 'Enter playlist name');

  if (!name || !name.trim()) return;

  const playlist = {
    id: `playlist-${Date.now()}`,
    name: name.trim(),
    trackIds: []
  };

  playlists.push(playlist);

  savePlaylists();

  activeTab = 'playlists';
  activePlaylist = playlist.id;

  render();
}

async function addCurrentToPlaylist() {
  if (current < 0) {
    showMessage('Choose a song first.');
    return;
  }

  if (!playlists.length) {
    await createPlaylist();
    if (!playlists.length) return;
  }

  const names = playlists
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join('\n');

  const choice = await showPrompt('Add to playlist', `Choose playlist number:\n${names}`);

  if (choice === null) return;

  const index = Number(choice) - 1;

  if (!Number.isInteger(index) || !playlists[index]) return;

  const id = tracks[current].id;

  if (!playlists[index].trackIds.includes(id)) {
    playlists[index].trackIds.push(id);
    savePlaylists();
    showMessage('Added to playlist.');
  } else {
    showMessage('This song is already in the playlist.');
  }
}

function render() {
  const visible = getVisibleTracks();
  const visibleTabs = document.querySelector('.library-tabs') || document.getElementById('musicTabs');
  if (visibleTabs) {
    visibleTabs.querySelectorAll('button').forEach(button => {
      const label = button.textContent.trim().toLowerCase();
      const name = button.dataset.tab || button.dataset.view || (label.includes('favorite') ? 'favorites' : label.includes('playlist') ? 'playlists' : 'all');
      button.classList.toggle('active', name === activeTab);
    });
  }

  $('trackCount').textContent =
    `${visible.length} ${visible.length === 1 ? 'song' : 'songs'}`;

  $('empty').hidden = visible.length > 0;

  $('tracks').innerHTML = visible.map(({ t, i }) => `
    <li class="track ${i === current ? 'active' : ''}"
        data-index="${i}">

      <input
        class="track-select"
        type="checkbox"
        data-select="${i}"
        aria-label="Select ${escapeHtml(t.name)}"
        ${selectedTracks.has(t.id) ? 'checked' : ''}>

      <div class="track-art">♫</div>

      <div class="track-info">
        <b>${escapeHtml(t.name)}</b>
        <small>
          ${t.source === 'music-library' ? 'iPhone Music' : 'Local file'}
          · ${escapeHtml(t.type || 'Audio')}
        </small>
      </div>

      <button class="row-play" aria-label="Play">
        ${i === current && isPlaying ? 'Ⅱ' : '▶'}
      </button>
      <button class="delete-track" type="button" data-delete-track="${i}" aria-label="Delete ${escapeHtml(t.name)}" title="Remove from library">✕</button>
    </li>
  `).join('');

  $('songTitle').textContent =
    current >= 0 ? tracks[current].name : 'Nothing playing';

  $('songSub').textContent =
    current >= 0
      ? (tracks[current].artist || 'On this device')
      : 'Choose a song to begin';

  $('favorite').textContent =
    current >= 0 && favorites.has(tracks[current].id)
      ? '♥'
      : '♡';

  $('play').textContent = isPlaying ? 'Ⅱ' : '▶';

  if (activeTab === 'playlists') {
    showPlaylistTools();
  } else {
    removePlaylistTools();
  }
}

function showPlaylistTools() {
  const panel = $('playlistPanel');
  const list = $('playlistList');
  const createButton = $('newPlaylist');
  if (!panel || !list || !createButton) return;

  panel.hidden = false;
  createButton.onclick = createPlaylist;

  const selectedPlaylist = playlists.find(p => p.id === activePlaylist);
  list.innerHTML = `
    <div class="playlist-items">
      ${playlists.length ? playlists.map(p => `
        <button type="button"
          class="outline-btn playlist-item ${p.id === activePlaylist ? 'active' : ''}"
          data-open-playlist="${escapeHtml(p.id)}">
          ${escapeHtml(p.name)} <span>${p.trackIds.length} songs</span>
        </button>
      `).join('') : '<p class="empty-playlists">No playlists yet. Create your first playlist.</p>'}
    </div>
    ${selectedPlaylist ? `
      <div class="playlist-detail">
        <p>${escapeHtml(selectedPlaylist.name)} · ${selectedPlaylist.trackIds.length} songs</p>
        <div class="playlist-tools">
          <button type="button" id="addSelected" class="outline-btn">Add Selected (${selectedTracks.size})</button>
          <button type="button" id="addToPlaylist" class="outline-btn">Add Current Song</button>
          <button type="button" id="removeSelected" class="outline-btn">Remove Selected</button>
        </div>
      </div>
    ` : ''}
  `;

  list.querySelectorAll('[data-open-playlist]').forEach(button => {
    button.addEventListener('click', () => {
      activePlaylist = button.dataset.openPlaylist;
      selectedTracks.clear();
      render();
    });
  });

  if (!selectedPlaylist) return;

  $('addToPlaylist').onclick = async () => {
    if (current < 0) {
      showMessage('Choose a song first.');
      return;
    }
    if (!selectedPlaylist.trackIds.includes(tracks[current].id)) {
      selectedPlaylist.trackIds.push(tracks[current].id);
      savePlaylists();
      render();
      showMessage('Added to playlist.');
    } else {
      showMessage('This song is already in the playlist.');
    }
  };

  $('addSelected').onclick = () => {
    if (!selectedTracks.size) {
      showMessage('Select one or more songs first.');
      return;
    }
    let added = 0;
    for (const id of selectedTracks) {
      if (tracks.some(t => t.id === id) && !selectedPlaylist.trackIds.includes(id)) {
        selectedPlaylist.trackIds.push(id);
        added++;
      }
    }
    savePlaylists();
    selectedTracks.clear();
    render();
    showMessage(`Added ${added} songs to ${selectedPlaylist.name}.`);
  };

  $('removeSelected').onclick = () => {
    if (!selectedTracks.size) {
      showMessage('Select songs to remove first.');
      return;
    }
    selectedPlaylist.trackIds = selectedPlaylist.trackIds.filter(id => !selectedTracks.has(id));
    selectedTracks.clear();
    savePlaylists();
    render();
  };
}

function removePlaylistTools() {
  const panel = $('playlistPanel');
  if (panel) panel.hidden = true;
}

async function chooseFiles() {
  if (isNative) {
    try {
      const result = await MusicPlayer.pickFiles();

      for (const item of (result.files || [])) {
        if (!tracks.some(t => t.id === item.id)) {
          tracks.push(item);
        }
      }

      saveLibrary();
      render();

      if (current < 0 && tracks.length) {
        await playTrack(0);
      }
    } catch (e) {
      showMessage(e?.message || 'Could not open Files picker.');
    }

    return;
  }

  const input = document.createElement('input');

  input.type = 'file';
  input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.flac';
  input.multiple = true;

  input.onchange = () => {
    for (const file of input.files || []) {
      tracks.push({
        id: `web-${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type || 'Audio',
        artist: 'Local file',
        source: 'web',
        webUrl: URL.createObjectURL(file)
      });
    }

    saveLibrary();
    render();
  };

  input.click();
}

async function loadIPhoneMusic() {
  if (!isNative) {
    showMessage('iPhone Music Library is available in the iPhone app only.');
    return;
  }

  try {
    const result = await MusicPlayer.getMusicLibrary();
    const imported = result.tracks || [];

    let added = 0;

    for (const item of imported) {
      if (!tracks.some(t => t.id === item.id)) {
        tracks.push({
          ...item,
          source: 'music-library'
        });

        added++;
      }
    }

    saveLibrary();
    render();

    showMessage(
      added
        ? `Added ${added} songs from your iPhone Music Library.`
        : imported.length
          ? 'These songs are already in your library.'
          : 'No downloadable songs were found.'
    );

  } catch (e) {
    showMessage(e?.message || 'Could not access your iPhone Music Library.');
  }
}

async function playTrack(index) {
  if (!tracks.length) return;

  current = (index + tracks.length) % tracks.length;

  const track = tracks[current];

  try {
    if (isNative) {
      const playback = await MusicPlayer.play({
        id: track.id,
        title: track.name
      });

      isPlaying = true;

      updateProgress({
        currentTime: playback?.currentTime || 0,
        duration: playback?.duration || 0
      });

    } else {
      if (!track.webUrl) {
        showMessage(
          'Please add this audio file again. Browser file access does not persist after reloading.'
        );
        return;
      }

      if (audio) {
        audio.pause();
        audio.onended = null;
      }

      audio = new Audio(track.webUrl);

      audio.onended = handleEnded;

      audio.ontimeupdate = () => {
        updateProgress({
          currentTime: audio.currentTime,
          duration: audio.duration
        });
      };

      await audio.play();

      isPlaying = true;
    }

    render();

  } catch (e) {
    isPlaying = false;
    showMessage(e?.message || 'Unable to play this audio file.');
    render();
  }
}

async function handleEnded() {
  isPlaying = false;

  if (repeat) {
    await playTrack(current);
    return;
  }

  if (isShuffle) {
    const choices = getQueueIndices().filter(
      i => i !== current
    );

    if (choices.length) {
      await playTrack(
        choices[Math.floor(Math.random() * choices.length)]
      );
      return;
    }
  }

  moveTrack(1, false);
}

let playbackControlBusy = false;

async function togglePlay() {
  if (playbackControlBusy) return;

  if (current < 0) {
    if (tracks.length) await playTrack(0);
    return;
  }

  const shouldPlay = !isPlaying;
  playbackControlBusy = true;

  try {
    if (isNative) {
      if (shouldPlay) {
        const result = await MusicPlayer.resume();
        isPlaying = result?.playing === false ? false : true;
      } else {
        const result = await MusicPlayer.pause();
        isPlaying = result?.playing === true ? true : false;
      }
    } else if (audio) {
      if (shouldPlay) {
        await audio.play();
      } else {
        audio.pause();
      }
      isPlaying = !audio.paused;
    } else {
      isPlaying = false;
    }

    render();
  } catch (e) {
    isPlaying = isNative ? false : !!audio && !audio.paused;
    render();
    showMessage(e?.message || 'Playback control failed.');
  } finally {
    playbackControlBusy = false;
  }
}

function updateProgress(state = {}) {
  const currentTime = Math.max(
    0,
    Number(state.currentTime) || 0
  );

  const duration = Math.max(
    0,
    Number(state.duration) || 0
  );

  if (duration > 0) {
    playbackDuration = duration;
  }

  $('elapsed').textContent = fmt(currentTime);

  $('duration').textContent =
    fmt(duration || playbackDuration);

  if (!isSeeking) {
    $('seek').value = duration > 0
      ? String(
          Math.min(
            1000,
            Math.round(currentTime / duration * 1000)
          )
        )
      : '0';
  }
}

async function finishSeeking() {
  if (!isSeeking) return;

  isSeeking = false;

  if (current < 0 || playbackDuration <= 0) return;

  const fraction = Number($('seek').value) / 1000;

  if (isNative) {
    await MusicPlayer.seek({ fraction });
  } else if (audio) {
    audio.currentTime = playbackDuration * fraction;
  }
}

// Main buttons

$('addMusic').onclick = chooseFiles;
$('browse').onclick = chooseFiles;
$('emptyAdd').onclick = chooseFiles;
$('iphoneMusic').onclick = loadIPhoneMusic;

$('play').onclick = togglePlay;

$('previous').onclick = () => {
  moveTrack(-1, true);
};

$('next').onclick = () => {
  if (isShuffle) {
    const choices = getQueueIndices().filter(
      i => i !== current
    );

    if (choices.length) {
      playTrack(
        choices[Math.floor(Math.random() * choices.length)]
      );
    }
  } else {
    moveTrack(1, true);
  }
};

$('shuffle').onclick = () => {
  isShuffle = !isShuffle;

  $('shuffle').classList.toggle(
    'selected',
    isShuffle
  );
};

$('repeat').onclick = () => {
  repeat = !repeat;

  $('repeat').classList.toggle(
    'selected',
    repeat
  );
};

$('favorite').onclick = () => {
  if (current < 0) return;

  const id = tracks[current].id;

  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }

  saveFavorites();
  render();
};

$('tracks').onclick = e => {
  const deleteButton = e.target.closest('[data-delete-track]');
  if (deleteButton) {
    e.preventDefault();
    e.stopPropagation();
    deleteLibraryTrack(Number(deleteButton.dataset.deleteTrack));
    return;
  }

  const checkbox = e.target.closest('[data-select]');

  if (checkbox) {
    const id = tracks[
      Number(checkbox.dataset.select)
    ]?.id;

    if (id) {
      if (checkbox.checked) {
        selectedTracks.add(id);
      } else {
        selectedTracks.delete(id);
      }
    }

    const addButton = document.getElementById('addSelected');

    if (addButton) {
      addButton.textContent =
        `Add Selected (${selectedTracks.size})`;
    }

    return;
  }

  const li = e.target.closest('[data-index]');

  if (li) {
    const index = Number(li.dataset.index);
    if (Number.isInteger(index) && index >= 0) {
      if (index === current) {
        togglePlay();
      } else {
        playTrack(index);
      }
    }
  }
};

// Progress bar

$('seek').onpointerdown = () => {
  isSeeking = true;
};

$('seek').oninput = () => {
  $('elapsed').textContent = fmt(
    playbackDuration * Number($('seek').value) / 1000
  );
};

$('seek').onchange = finishSeeking;
$('seek').onpointerup = finishSeeking;
$('seek').ontouchend = finishSeeking;

// Native iPhone playback events

if (isNative) {
  MusicPlayer.addListener('playbackState', state => {
    isPlaying = !!state.playing;
    render();
  });

  MusicPlayer.addListener(
    'playbackProgress',
    updateProgress
  );

  // Native AVAudioPlayer finishes with a trackFinished event.
  // Advance the queue just like the browser audio onended handler.
  MusicPlayer.addListener(
    'trackFinished',
    () => handleEnded()
  );

  MusicPlayer.addListener(
    'remoteNext',
    () => handleEnded()
  );

  MusicPlayer.addListener(
    'remotePrevious',
    () => moveTrack(-1, true)
  );

  MusicPlayer.addListener(
    'remotePlayPause',
    togglePlay
  );
}

createTabs();
render();
