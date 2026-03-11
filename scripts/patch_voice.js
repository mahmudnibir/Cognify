const fs = require('fs');
const c = fs.readFileSync('video-hover.js', 'utf8');

const newFn = `
  /**
   * Applies a voice mode DSP chain to any video element (8 modes).
   * Skipped on YouTube - content.js handles DSP there.
   * @param {HTMLVideoElement} videoEl
   * @param {string} mode  normal|chipmunk|pikachu|naruto|doraemon|bassboost|robot|echo
   */
  function applyVoiceMode(videoEl, mode) {
    if (!videoEl) return;
    if (location.hostname.includes('youtube.com')) return;

    // chipmunk/pikachu/doraemon: pitch should shift with playback rate
    const preservePitch = !['chipmunk', 'pikachu', 'doraemon'].includes(mode);
    if (typeof videoEl.preservesPitch    !== 'undefined') videoEl.preservesPitch    = preservePitch;
    if (typeof videoEl.mozPreservesPitch !== 'undefined') videoEl.mozPreservesPitch = preservePitch;

    // Normal: no DSP, ensure chain is bypassed
    if (mode === 'normal') {
      if (_audioChains.has(videoEl)) {
        const chain = _audioChains.get(videoEl);
        clearChainNodes(chain);
        chain.source.connect(chain.ctx.destination);
      }
      return;
    }

    const chain = getOrCreateAudioChain(videoEl);
    if (!chain) return;
    const { ctx, source } = chain;
    if (ctx.state === 'suspended') ctx.resume();
    clearChainNodes(chain);

    if (mode === 'chipmunk') {
      // High-pitch: boost highs, cut lows, boost presence
      const lo  = ctx.createBiquadFilter(); lo.type  = 'highpass';  lo.frequency.value = 500;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking';   mid.frequency.value = 3000; mid.gain.value = 6;
      const hi  = ctx.createBiquadFilter(); hi.type  = 'highshelf'; hi.frequency.value = 8000; hi.gain.value = 8;
      source.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(ctx.destination);
      chain.activeNodes = [lo, mid, hi];

    } else if (mode === 'pikachu') {
      // Cute/bright: extreme high-pass + bell boost + air shelf
      const lo   = ctx.createBiquadFilter(); lo.type   = 'highpass';  lo.frequency.value = 800;
      const bell = ctx.createBiquadFilter(); bell.type = 'peaking';   bell.frequency.value = 4500; bell.Q.value = 1.5; bell.gain.value = 9;
      const air  = ctx.createBiquadFilter(); air.type  = 'highshelf'; air.frequency.value = 10000; air.gain.value = 10;
      source.connect(lo); lo.connect(bell); bell.connect(air); air.connect(ctx.destination);
      chain.activeNodes = [lo, bell, air];

    } else if (mode === 'naruto') {
      // Energetic: vocal boost + presence peak
      const sub  = ctx.createBiquadFilter(); sub.type  = 'highpass'; sub.frequency.value = 100;
      const mid  = ctx.createBiquadFilter(); mid.type  = 'peaking';  mid.frequency.value = 2500; mid.Q.value = 0.8; mid.gain.value = 7;
      const pres = ctx.createBiquadFilter(); pres.type = 'peaking';  pres.frequency.value = 6000; pres.Q.value = 1.2; pres.gain.value = 5;
      source.connect(sub); sub.connect(mid); mid.connect(pres); pres.connect(ctx.destination);
      chain.activeNodes = [sub, mid, pres];

    } else if (mode === 'doraemon') {
      // Warm/round: low-pass roll-off + warm low-mid boost
      const lp   = ctx.createBiquadFilter(); lp.type   = 'lowpass'; lp.frequency.value = 6000;
      const warm = ctx.createBiquadFilter(); warm.type = 'peaking'; warm.frequency.value = 400; warm.Q.value = 0.9; warm.gain.value = 6;
      source.connect(warm); warm.connect(lp); lp.connect(ctx.destination);
      chain.activeNodes = [warm, lp];

    } else if (mode === 'bassboost') {
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 200;
      shelf.gain.value = 10;
      source.connect(shelf);
      shelf.connect(ctx.destination);
      chain.activeNodes = [shelf];

    } else if (mode === 'robot') {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 30;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0;
      source.connect(gainNode);
      osc.connect(gainNode.gain);
      gainNode.connect(ctx.destination);
      osc.start();
      chain.activeNodes = [gainNode];
      chain.oscNodes    = [osc];

    } else if (mode === 'echo') {
      const delay    = ctx.createDelay(3.0);
      delay.delayTime.value = 0.25;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.45;
      const wetGain  = ctx.createGain();
      wetGain.gain.value = 0.55;
      source.connect(ctx.destination);
      source.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wetGain);
      wetGain.connect(ctx.destination);
      chain.activeNodes = [delay, feedback, wetGain];
    }
  }`;

// Replace from jsdocStart+1 (13174) to end of function (15659)
const before = c.slice(0, 13174);
const after  = c.slice(15660);
const result = before + newFn + after;

fs.writeFileSync('video-hover.js', result, 'utf8');
console.log('Done. New length:', result.length);
