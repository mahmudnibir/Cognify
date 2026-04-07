// src/download.js

function downloadVideo(videoId) {
  chrome.runtime.sendMessage({
    type: 'downloadVideo',
    videoId: videoId
  });
}
