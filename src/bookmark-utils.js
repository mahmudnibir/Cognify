function sortBookmarks(bookmarks) {
  return [...bookmarks].sort((a, b) => a.time - b.time);
}

function getBookmarkStorageKey(videoId) {
  if (typeof videoId !== 'string' || videoId.trim() === '') return null;
  return `yt_bm_${videoId.trim()}`;
}

function findBookmarkIndex(bookmarks, time) {
  const idx = bookmarks.findIndex((bm) => bm.time === time);
  return idx >= 0 ? idx : -1;
}

function findRelativeBookmarkIndex(bookmarks, currentTime, direction) {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) return -1;

  const safeBookmarks = sortBookmarks(bookmarks);
  const current = Number.isFinite(currentTime) ? currentTime : 0;
  const dir = direction === 'prev' ? 'prev' : 'next';

  if (dir === 'next') {
    const nextIndex = safeBookmarks.findIndex((bm) => bm.time > current);
    return nextIndex === -1 ? safeBookmarks.length - 1 : nextIndex;
  }

  const prevIndex = safeBookmarks.slice().reverse().findIndex((bm) => bm.time < current);
  return prevIndex === -1 ? 0 : safeBookmarks.length - 1 - prevIndex;
}

function getBookmarkVideos(data) {
  return Object.entries(data || {})
    .filter(([key, marks]) => key.startsWith('yt_bm_') && Array.isArray(marks))
    .map(([key, marks]) => {
      const bookmarks = marks
        .filter((mark) => Number.isFinite(Number(mark.time)))
        .map((mark) => ({ ...mark, time: Number(mark.time) }))
        .sort((a, b) => a.time - b.time);
      return {
        videoId: key.slice(6),
        bookmarks,
        title: bookmarks.find((mark) => mark.title)?.title || `YouTube video (${key.slice(6)})`,
        channel: bookmarks.find((mark) => mark.channel)?.channel || '',
        duration: Number(bookmarks.find((mark) => Number.isFinite(Number(mark.duration)))?.duration || 0),
        lastViewedAt: bookmarks.reduce((latest, mark) => Math.max(latest, Date.parse(mark.createdAt || mark.viewedAt || '') || 0), 0),
      };
    })
    .filter((video) => video.bookmarks.length);
}

function sortBookmarkVideos(videos, sortBy = 'most') {
  const sortedVideos = Array.isArray(videos) ? [...videos] : [];
  const compareTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
  const compareRecent = (a, b) => (Number(b.lastViewedAt) || 0) - (Number(a.lastViewedAt) || 0);
  const compareBookmarkCount = (a, b) => b.bookmarks.length - a.bookmarks.length;

  if (sortBy === 'title') return sortedVideos.sort(compareTitle);
  if (sortBy === 'recent') return sortedVideos.sort((a, b) => compareRecent(a, b) || compareBookmarkCount(a, b) || compareTitle(a, b));
  return sortedVideos.sort((a, b) => compareBookmarkCount(a, b) || compareRecent(a, b) || compareTitle(a, b));
}

function filterBookmarkVideos(videos, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const label = String(filters.label || '').trim().toLowerCase();
  const channel = String(filters.channel || '').trim().toLowerCase();
  const maxDuration = Number(filters.maxDuration);
  const since = filters.since ? Date.parse(filters.since) : 0;

  return (Array.isArray(videos) ? videos : []).filter((video) => {
    const searchable = `${video.title} ${video.videoId} ${video.channel} ${video.bookmarks.map((mark) => mark.label || '').join(' ')}`.toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (label && !video.bookmarks.some((mark) => String(mark.label || '').toLowerCase().includes(label))) return false;
    if (channel && !String(video.channel || '').toLowerCase().includes(channel)) return false;
    if (since && video.lastViewedAt && video.lastViewedAt < since) return false;
    if (Number.isFinite(maxDuration) && maxDuration > 0 && video.duration > maxDuration) return false;
    return true;
  });
}

function normalizeBookmarkCollections(value) {
  const source = value && typeof value === 'object' ? value : {};
  const collectionNames = new Set();
  const memberships = {};
  const addCollection = (name) => {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (normalized) collectionNames.add(normalized);
    return normalized;
  };
  const addMembership = (videoId, names) => {
    if (typeof videoId !== 'string' || !videoId.trim()) return;
    const list = Array.isArray(names) ? names : [names];
    const normalizedNames = [...new Set(list.map(addCollection).filter(Boolean))];
    if (normalizedNames.length) memberships[videoId] = normalizedNames;
  };

  if (Array.isArray(source.collections)) source.collections.forEach(addCollection);
  if (source.memberships && typeof source.memberships === 'object') {
    Object.entries(source.memberships).forEach(([videoId, names]) => addMembership(videoId, names));
  }
  if (source.folders && typeof source.folders === 'object') {
    Object.entries(source.folders).forEach(([key, value]) => {
      if (typeof value === 'string' && (!value || key === value)) {
        addCollection(key);
        return;
      }
      addMembership(key, value);
    });
  }

  return {
    collections: [...collectionNames],
    memberships,
    shared: Array.isArray(source.shared) ? source.shared : [],
  };
}

function createBookmarkCollectionShare(name, bookmarkData, collectionState) {
  const collectionName = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  const collections = normalizeBookmarkCollections(collectionState);
  if (!collectionName || collectionName.toLowerCase() === 'all' || !collections.collections.includes(collectionName)) return null;

  const bookmarks = Object.fromEntries(Object.entries(bookmarkData || {}).filter(([key, marks]) => (
    key.startsWith('yt_bm_')
    && Array.isArray(marks)
    && marks.length > 0
    && (collections.memberships[key.slice(6)] || []).includes(collectionName)
  )));
  return { format: 'cognify-collection', version: 1, name: collectionName, bookmarks };
}

function parseBookmarkCollectionShare(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.format !== 'cognify-collection' || value.version !== 1) return null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 40) : '';
  if (!name || name.toLowerCase() === 'all' || !value.bookmarks || typeof value.bookmarks !== 'object' || Array.isArray(value.bookmarks)) return null;
  const bookmarks = Object.fromEntries(Object.entries(value.bookmarks).filter(([key, marks]) => (
    key.startsWith('yt_bm_') && Array.isArray(marks) && marks.length > 0
  )));
  return { name, bookmarks };
}

function addVideoToCollection(collections, videoId, collectionName) {
  const name = typeof collectionName === 'string' ? collectionName.trim() : '';
  if (!name || !videoId || !collections?.collections?.includes(name)) return false;
  const current = collections.memberships[videoId] || [];
  if (current.includes(name)) return false;
  collections.memberships[videoId] = [...current, name];
  return true;
}

function removeVideoFromCollection(collections, videoId, collectionName) {
  const current = collections?.memberships?.[videoId];
  if (!Array.isArray(current) || !current.includes(collectionName)) return false;
  const remaining = current.filter((name) => name !== collectionName);
  if (remaining.length) collections.memberships[videoId] = remaining;
  else delete collections.memberships[videoId];
  return true;
}

function findShortcutConflict(shortcuts, candidate, action) {
  const normalized = String(candidate || '').trim().toLowerCase();
  if (!normalized) return null;
  return Object.entries(shortcuts || {}).find(([name, shortcut]) => name !== action && String(shortcut).trim().toLowerCase() === normalized)?.[0] || null;
}

const bookmarkUtils = {
  sortBookmarks,
  getBookmarkStorageKey,
  findBookmarkIndex,
  findRelativeBookmarkIndex,
  getBookmarkVideos,
  sortBookmarkVideos,
  filterBookmarkVideos,
  normalizeBookmarkCollections,
  createBookmarkCollectionShare,
  parseBookmarkCollectionShare,
  addVideoToCollection,
  removeVideoFromCollection,
  findShortcutConflict,
};

if (typeof module !== 'undefined') module.exports = bookmarkUtils;
if (typeof globalThis !== 'undefined') globalThis.CognifyBookmarkUtils = bookmarkUtils;
