const assert = require('node:assert/strict');
const {
  findRelativeBookmarkIndex,
  sortBookmarks,
  getBookmarkStorageKey,
  getBookmarkVideos,
  sortBookmarkVideos,
  filterBookmarkVideos,
  normalizeBookmarkCollections,
  createBookmarkCollectionShare,
  parseBookmarkCollectionShare,
  addVideoToCollection,
  removeVideoFromCollection,
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

const collections = normalizeBookmarkCollections({
  folders: {
    Algebra: '',
    Biology: 'Biology',
    'video-a': 'Algebra',
    'video-b': 'Biology',
  },
  shared: [],
});
assert.deepEqual(collections.collections, ['Algebra', 'Biology']);
assert.deepEqual(collections.memberships, {
  'video-a': ['Algebra'],
  'video-b': ['Biology'],
});
assert.deepEqual(normalizeBookmarkCollections(collections), collections, 'normalized collection data should remain stable when loaded again');
assert.equal(addVideoToCollection(collections, 'video-a', 'Biology'), true);
assert.deepEqual(collections.memberships['video-a'], ['Algebra', 'Biology']);
assert.equal(addVideoToCollection(collections, 'video-a', 'Biology'), false, 'adding an existing membership should be idempotent');
assert.equal(addVideoToCollection(collections, 'video-a', 'Chemistry'), false, 'videos cannot be assigned to collections that do not exist');
assert.equal(removeVideoFromCollection(collections, 'video-a', 'Algebra'), true);
assert.deepEqual(collections.memberships['video-a'], ['Biology']);
assert.equal(removeVideoFromCollection(collections, 'video-a', 'Biology'), true);
assert.equal(collections.memberships['video-a'], undefined);

const shareCollections = normalizeBookmarkCollections({
  collections: ['Physics'],
  memberships: {
    lesson: ['Physics'],
    unrelated: ['Other'],
  },
});
const sharedBookmarks = {
  yt_bm_lesson: [{ time: 12, title: 'Physics lesson' }],
  yt_bm_unrelated: [{ time: 24, title: 'Other lesson' }],
  yt_bm_empty: [],
  not_a_bookmark: [{ time: 1 }],
};
const collectionShare = createBookmarkCollectionShare('Physics', sharedBookmarks, shareCollections);
assert.deepEqual(collectionShare, {
  format: 'cognify-collection',
  version: 1,
  name: 'Physics',
  bookmarks: { yt_bm_lesson: sharedBookmarks.yt_bm_lesson },
});
assert.deepEqual(parseBookmarkCollectionShare(collectionShare), {
  name: 'Physics',
  bookmarks: { yt_bm_lesson: sharedBookmarks.yt_bm_lesson },
});
assert.equal(createBookmarkCollectionShare('Missing', sharedBookmarks, shareCollections), null);
assert.equal(parseBookmarkCollectionShare({ ...collectionShare, version: 2 }), null);

assert.equal(findShortcutConflict({ addBookmark: 'P', showHelp: 'Shift+?' }, 'p', 'showHelp'), 'addBookmark');
assert.equal(findShortcutConflict({ addBookmark: 'P' }, 'L', 'showHelp'), null);

console.log('bookmark-utils regression tests passed');
