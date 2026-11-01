
import { registerPlugin } from '@capacitor/core';
import './style.css';

const MusicPlayer = registerPlugin('MusicPlayer');
const $ = (id) => document.getElementById(id);

const STORAGE_KEY = 'twk_music_library_v1';
const FAVORITES_KEY = 'twk_music_favorites_v1';

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

let tracks = loadJSON(STORAGE_KEY, []);
let current = -1;
let isPlaying = false;
let isShuffle = false;
let repeat = false;
let favorites = new Set(loadJSON(FAVORITES_KEY, []));

let playbackDuration = 0;
let isSeeking = false;

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

const fmt = (seconds = 0) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '0:00';

  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// MARK: - Render

function render() {
  $('trackCount').textContent =
    `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;

  $('empty').hidden = tracks.length > 0;

  $('tracks').innerHTML = tracks.map((t, i) => {
    const sourceLabel = t.source === 'library'
      ? `iPhone Music · ${escapeHtml(t.artist || 'Unknown Artist')}`
      : `Local file · ${escapeHtml(t.type || 'Audio')}`;

    return `
      <li class="track ${i === current ? 'active' : ''}" data-index="${i}">
        <div class="track-art">♫</div>
        <div class="track-info">
          <b>${escapeHtml(t.name)}</b>
          <small>${sourceLabel}</small>
        </div>
        <button class="row-play" aria-label="Play">
          ${i === current && isPlaying ? 'Ⅱ' : '▶'}
        </button>
      </li>
    `;
  }).join('');

  $('songTitle').textContent =
    current >= 0 ? tracks[current].name : 'Nothing playing';

  $('songSub').textContent = current >= 0
    ? (tracks[current].source === 'library'
      ? (tracks[current].artist || 'iPhone Music')
      : 'On this iPhone')
    : 'Choose a song to begin';

  $('favorite').textContent =
    current >= 0 && favorites.has(tracks[current].id) ? '♥' : '♡';

  $('play').textContent = isPlaying ? 'Ⅱ' : '▶';
}

// MARK: - Files picker

async function chooseFiles() {
  try {
    const result = await MusicPlayer.pickFiles();

    for (const item of (result.files || [])) {
      if (!tracks.some(t => t.id === item.id)) {
        tracks.push({
          ...item,
          source: 'file'
        });
      }
    }

    saveLibrary();
    render();

    if (current < 0 && tracks.length) {
      await playTrack(0);
    }
  } catch (e) {
    alert(e?.message || 'Could not open the Files picker.');
  }
}

// MARK: - iPhone Music Library

async function loadIPhoneMusic() {
  const button = $('nativeLibrary');

  if (!button) return;

  button.disabled = true;
  button.textContent = 'Loading Music...';

  try {
    const result = await MusicPlayer.getLibrarySongs();
    const songs = result.songs || [];

    if (songs.length === 0) {
      alert('No songs were found in your iPhone Music Library.');
      return;
    }

    let added = 0;

    for (const song of songs) {
      const exists = tracks.some(t => t.id === song.id);

      if (!exists) {
        tracks.push({
          ...song,
          source: 'library'
        });
        added++;
      }
    }

    saveLibrary();
    render();

    alert(
      `${songs.length} songs found in iPhone Music Library.\n` +
      `${added} new songs added to TWK Music.`
    );

  } catch (e) {
    alert(
      e?.message ||
      'Unable to access iPhone Music Library. Please check permission in Settings.'
    );
  } finally {
    button.disabled = false;
    button.textContent = '♫ iPhone Music';
  }
}

// MARK: - Playback

async function playTrack(index) {
  if (!tracks.length) return;

  current = (index + tracks.length) % tracks.length;

  const track = tracks[current];

  try {
    const playback = await MusicPlayer.play({
      id: track.id,
      title: track.name
    });

    isPlaying = true;

    updateProgress({
      currentTime: Number(playback?.currentTime) || 0,
      duration: Number(playback?.duration) || 0
    });

    render();

  } catch (e) {
    isPlaying = false;
    render();

    alert(
      e?.message ||
      'Unable to play this song. It may be protected or unavailable.'
    );
  }
}

async function togglePlay() {
  if (current < 0) {
    if (tracks.length) {
      await playTrack(0);
    }
    return;
  }

  try {
    if (isPlaying) {
      await MusicPlayer.pause();
      isPlaying = false;
    } else {
      await MusicPlayer.resume();
      isPlaying = true;
    }

    render();
  } catch (e) {
    alert(e?.message || 'Playback control failed.');
  }
}

// MARK: - Buttons

$('addMusic').onclick =
$('browse').onclick =
$('emptyAdd').onclick = chooseFiles;

$('nativeLibrary').onclick = loadIPhoneMusic;

$('play').onclick = togglePlay;

$('previous').onclick = () => {
  if (!tracks.length) return;

  if (isShuffle && tracks.length > 1) {
    let next;
    do {
      next = Math.floor(Math.random() * tracks.length);
    } while (next === current);

    playTrack(next);
  } else {
    playTrack(current <= 0 ? tracks.length - 1 : current - 1);
  }
};

$('next').onclick = () => {
  if (!tracks.length) return;

  if (isShuffle && tracks.length > 1) {
    let next;
    do {
      next = Math.floor(Math.random() * tracks.length);
    } while (next === current);

    playTrack(next);
  } else {
    playTrack(current + 1);
  }
};

$('shuffle').onclick = () => {
  isShuffle = !isShuffle;
  $('shuffle').classList.toggle('selected', isShuffle);
};

$('repeat').onclick = () => {
  repeat = !repeat;
  $('repeat').classList.toggle('selected', repeat);
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

$('tracks').onclick = (e) => {
  const li = e.target.closest('[data-index]');
  if (li) playTrack(Number(li.dataset.index));
};

// MARK: - Native playback events

MusicPlayer.addListener('playbackState', state => {
  isPlaying = !!state.playing;
  render();
});

MusicPlayer.addListener('playbackProgress', updateProgress);

MusicPlayer.addListener('remoteNext', () => {
  if (tracks.length) $('next').click();
});

MusicPlayer.addListener('remotePrevious', () => {
  if (tracks.length) $('previous').click();
});

MusicPlayer.addListener('remotePlayPause', togglePlay);

// MARK: - Progress

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
  $('duration').textContent = fmt(duration || playbackDuration);

  if (!isSeeking) {
    $('seek').value = duration > 0
      ? String(Math.max(
          0,
          Math.min(1000, Math.round(currentTime / duration * 1000))
        ))
      : '0';
  }
}

$('seek').onpointerdown = () => {
  isSeeking = true;
};

$('seek').oninput = () => {
  const previewTime =
    playbackDuration * Number($('seek').value) / 1000;

  $('elapsed').textContent = fmt(previewTime);
};

async function finishSeeking() {
  if (!isSeeking) return;

  isSeeking = false;

  if (current >= 0 && playbackDuration > 0) {
    const fraction = Number($('seek').value) / 1000;

    try {
      await MusicPlayer.seek({ fraction });

      updateProgress({
        currentTime: playbackDuration * fraction,
        duration: playbackDuration
      });
    } catch (e) {
      console.error('Seek failed:', e);
    }
  }
}

$('seek').onchange = finishSeeking;
$('seek').onpointerup = finishSeeking;
$('seek').ontouchend = finishSeeking;

// MARK: - Initial render

render();
