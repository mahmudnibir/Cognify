const assert = require('node:assert/strict');
const {
  findRelativeBookmarkIndex,
  sortBookmarks,
  getBookmarkStorageKey,
  getBookmarkVideos,
  sortBookmarkVideos,
  filterBookmarkVideos,
  findShortcutConflict,
} = require('../src/bookmark-utils.js');

assert.equal(getBookmarkStorageKey('video-a'), 'yt_bm_video-a');
assert.equal(getBookmarkStorageKey(' video-b '), 'yt_bm_video-b');
assert.equal(getBookmarkStorageKey(''), null);

const bookmarks = sortBookmarks([
  { time: 10, label: 'start' },
  { time: 45, label: 'mid' },
  { time: 90, label: 'end' }
]);

assert.equal(findRelativeBookmarkIndex(bookmarks, 30, 'next'), 1, 'next should move to the first bookmark after the current time');
assert.equal(findRelativeBookmarkIndex(bookmarks, 30, 'prev'), 0, 'prev should move to the last bookmark before the current time');
assert.equal(findRelativeBookmarkIndex(bookmarks, 90, 'next'), 2, 'next should stay on the final bookmark when already at the end');
assert.equal(findRelativeBookmarkIndex(bookmarks, 10, 'prev'), 0, 'prev should stay on the first bookmark when there is no earlier mark');
assert.equal(findRelativeBookmarkIndex(bookmarks, 45, 'next'), 2, 'next should skip forward from the current bookmark');

const videos = getBookmarkVideos({
  yt_bm_alpha: [{ time: 12, title: 'Algebra lesson', label: 'formula', channel: 'Study Lab', duration: 900, createdAt: '2026-08-20T10:00:00Z' }],
  yt_bm_beta: [{ time: 4, title: 'Career talk', channel: 'Work Lab', duration: 2400 }],
});
const sortableVideos = [
  { videoId: 'old', title: 'Zulu', bookmarks: [{}, {}, {}], lastViewedAt: 10 },
  { videoId: 'new', title: 'Alpha', bookmarks: [{}], lastViewedAt: 50 },
  { videoId: 'middle', title: 'Beta', bookmarks: [{}, {}], lastViewedAt: 20 },
];
assert.deepEqual(sortBookmarkVideos(sortableVideos, 'recent').map(video => video.videoId), ['new', 'middle', 'old']);
assert.deepEqual(sortBookmarkVideos(sortableVideos, 'title').map(video => video.videoId), ['new', 'middle', 'old']);
assert.deepEqual(sortBookmarkVideos(sortableVideos).map(video => video.videoId), ['old', 'middle', 'new']);
assert.equal(filterBookmarkVideos(videos, { label: 'formula', channel: 'study' }).length, 1);
assert.equal(filterBookmarkVideos(videos, { maxDuration: 1000 }).length, 1);
assert.equal(findShortcutConflict({ addBookmark: 'P', showHelp: 'Shift+?' }, 'p', 'showHelp'), 'addBookmark');
assert.equal(findShortcutConflict({ addBookmark: 'P' }, 'L', 'showHelp'), null);

console.log('bookmark-utils regression tests passed');
