(() => {
  'use strict';

  /* ---------- constants / state ---------- */
  const PLATFORMS = ['mixcloud', 'soundcloud'];
  const LABEL = { mixcloud: 'Mixcloud', soundcloud: 'SoundCloud' };
  const POLL_MS = 30000;
  const MAX_BYTES = 750 * 1024 * 1024;

  const documentId = new URLSearchParams(location.search).get('id');
  let token = null;
  let status = null;        // last /status payload
  let formReady = false;    // form prefilled once
  let file = null;          // picked File
  let xhr = null;           // in-flight upload
  let pollTimer = null;
  let busy = { upload: false, save: false, publish: null, check: false };

  const $ = (id) => document.getElementById(id);
  const el = { app: $('app'), notice: $('notice') };

  /* ---------- auth: same-origin admin session ---------- */
  // Strapi admin keeps its JWT in localStorage 'jwtToken' (remember-me,
  // JSON-stringified) or in a Path=/ cookie 'jwtToken' (session login).
  function readToken() {
    try {
      const ls = localStorage.getItem('jwtToken');
      if (ls) return JSON.parse(ls);
    } catch (e) { /* fall through to cookie */ }
    const hit = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('jwtToken='));
    return hit ? decodeURIComponent(hit.slice('jwtToken='.length)) : null;
  }

  /* ---------- activity log / toasts ---------- */
  function log(level, text, detail) {
    const box = $('log');
    const entry = document.createElement('div');
    entry.className = 'entry';
    const time = new Date().toLocaleTimeString('en-GB');
    entry.innerHTML = '<span class="t"></span><span class="' + level + '"></span>';
    entry.children[0].textContent = time;
    entry.children[1].textContent = text;
    if (detail) {
      const d = document.createElement('div');
      d.className = 'detail';
      d.textContent = String(detail);
      entry.appendChild(d);
    }
    // keep the blinking cursor as the first child, newest entry right after it
    box.insertBefore(entry, box.children[1] || null);
    while (box.children.length > 201) box.removeChild(box.lastChild);
  }

  function toast(kind, text) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 5200);
  }

  /* ---------- api ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  const errDetail = (e) =>
    'HTTP ' + (e.status || '?') + (e.body ? ' — ' + JSON.stringify(e.body) : '');

  function handleAuthError(e) {
    if (e.status === 401) {
      showNotice('Admin session expired',
        'Log into the Strapi admin in another tab, then reload this page (or reopen it from the episode’s Radio Cult panel).');
      return true;
    }
    return false;
  }

  /* ---------- notices ---------- */
  function showNotice(title, text) {
    el.app.classList.add('hidden');
    el.notice.classList.remove('hidden');
    $('notice-title').textContent = title;
    $('notice-text').textContent = text;
  }

  /* ---------- status / render ---------- */
  async function fetchStatus(refresh) {
    try {
      const data = await api('/radiocult/episodes/' + encodeURIComponent(documentId) + '/status' + (refresh ? '?refresh=true' : ''));
      const prev = status;
      status = data;
      PLATFORMS.forEach((p) => {
        const before = prev && prev.platforms[p].link;
        const after = data.platforms[p].link;
        if (!before && after) {
          log('info', LABEL[p] + ' link saved to the episode', after);
          toast('success', LABEL[p] + ' link saved to the episode ✨');
          document.querySelector('.platform[data-platform="' + p + '"] .pstatus').classList.add('saved');
        }
      });
      if (data.rateLimitMessage) log('warn', data.rateLimitMessage);
      // Tab title: "↑<show name>", so a row of open uploader tabs is readable.
      const tabName = (data.details && (data.details.showName || data.details.title)) || '';
      document.title = tabName ? '↑' + tabName : '↑ Episode uploader';
      render();
      return data;
    } catch (e) {
      if (handleAuthError(e)) return null;
      log('error', 'Could not load the episode status', e.message + ' (' + errDetail(e) + ')');
      if (!status) showNotice('Could not load the episode', e.message + ' — check the server, then reload this page.');
      return null;
    }
  }

  function render() {
    if (!status) return;
    if (!status.enabled) {
      showNotice('Radio Cult is switched off',
        'Uploads are disabled — check RADIOCULT_ENABLED, RADIOCULT_API_KEY and RADIOCULT_STATION_ID on the server.');
      return;
    }
    el.notice.classList.add('hidden');
    el.app.classList.remove('hidden');

    // prefill the form once — later polls must not clobber edits
    if (!formReady) {
      const d = status.details;
      $('f-title').value = d.title || '';
      $('f-artist').value = d.artist || '';
      $('f-album').value = d.album || '';
      $('f-tags').value = (d.genres || []).join(', ');
      $('f-desc').value = d.description || '';
      $('strap-title').textContent = d.title || documentId;
      renderArtwork(d.image); // tab title is set in fetchStatus
      formReady = true;
      log('info', 'Episode loaded', 'documentId ' + documentId);
    }

    const hasTrack = !!status.trackId;
    const anyPublishing = PLATFORMS.some((p) => status.platforms[p].state === 'publishing');

    // step cards
    $('card1').classList.toggle('done', hasTrack);
    $('card1').classList.toggle('active', !hasTrack);
    $('badge1').textContent = hasTrack ? '✓' : '1';
    $('card2').classList.toggle('done', hasTrack);
    $('card2').classList.toggle('active', !hasTrack);
    $('badge2').textContent = hasTrack ? '✓' : '2';
    const allLinked = PLATFORMS.every((p) => status.platforms[p].state === 'linked');
    $('card3').classList.toggle('locked', !hasTrack);
    $('card3').classList.toggle('active', hasTrack && !allLinked);
    $('card3').classList.toggle('done', allLinked);
    $('badge3').textContent = allLinked ? '✓' : '3';
    $('publish-hint').textContent = hasTrack ? '' : 'Unlocks after step 2 — publishing goes through Radio Cult.';

    // step 2 content
    $('savedetails-row').classList.toggle('hidden', !hasTrack);
    const line = $('uploaded-line');
    line.classList.toggle('hidden', !hasTrack);
    if (hasTrack) {
      line.textContent = '✓ Track uploaded' +
        (status.uploadedAt ? ' on ' + new Date(status.uploadedAt).toLocaleString('en-GB') : '') +
        ' (id ' + status.trackId + ')';
      $('btn-upload').textContent = 'Replace track on Radio Cult';
      $('btn-upload').classList.add('danger');
      $('upload-hint').textContent = 'Pick a new file only if you need to replace the audio';
    } else {
      $('btn-upload').textContent = 'Upload to Radio Cult';
      $('btn-upload').classList.remove('danger');
    }
    $('btn-upload').disabled = !file || busy.upload;

    // platforms
    PLATFORMS.forEach((p) => {
      const box = document.querySelector('.platform[data-platform="' + p + '"]');
      const stat = box.querySelector('.pstatus');
      const btn = box.querySelector('.publish-btn');
      const s = status.platforms[p];
      box.classList.toggle('glow', s.state === 'publishing' || s.state === 'linked');
      btn.classList.remove('hidden');
      if (s.state === 'linked' && s.link) {
        stat.innerHTML = '';
        const a = document.createElement('a');
        a.href = s.link; a.target = '_blank'; a.rel = 'noreferrer';
        a.textContent = s.link;
        stat.appendChild(a);
        btn.classList.add('hidden');
      } else if (s.state === 'publishing') {
        stat.innerHTML = '<span class="pulse"></span>Publishing… link is saved to the episode automatically.';
        btn.classList.add('hidden');
      } else if (s.state === 'stalled') {
        stat.textContent = 'No link after 7 days — the transfer probably failed.';
        btn.textContent = 'Publish again';
      } else {
        stat.textContent = 'Not published yet.';
        btn.textContent = 'Publish to ' + LABEL[p];
      }
      btn.disabled = !hasTrack || !!busy.publish;
    });

    // header EQ animates while anything is in flight
    $('eq').classList.toggle('paused', !(busy.upload || anyPublishing));

    schedulePoll(anyPublishing);
  }

  function renderArtwork(image) {
    const box = $('artwork');
    box.innerHTML = '';
    if (image && image.previewUrl) {
      const img = document.createElement('img');
      img.src = image.previewUrl;
      img.alt = image.name || 'episode artwork';
      box.appendChild(img);
      const div = document.createElement('div');
      div.className = 'fine';
      div.textContent = 'Artwork comes from the episode image — change it on the episode page.' +
        (image.usable ? '' : ' ⚠ No jpeg/png version under 2MB, so Mixcloud/SoundCloud may get no artwork.');
      box.appendChild(div);
    } else {
      const div = document.createElement('div');
      div.className = 'warnline';
      div.textContent = 'No episode image set — the track and publishes will have no artwork.';
      box.appendChild(div);
    }
  }

  function schedulePoll(shouldPoll) {
    if (shouldPoll && !pollTimer) {
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !busy.upload) fetchStatus(false);
      }, POLL_MS);
    } else if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ---------- form helpers ---------- */
  const formMeta = () => ({
    title: $('f-title').value.trim(),
    artist: $('f-artist').value.trim(),
    album: $('f-album').value.trim(),
  });
  const formTags = () => $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);

  /* ---------- file picking ---------- */
  function setFile(f) {
    if (f) {
      const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      if (ext !== '.mp3' && ext !== '.m4a') {
        log('error', 'Rejected "' + f.name + '"', 'Radio Cult only accepts .mp3 or .m4a');
        toast('danger', 'Only .mp3 or .m4a files can be uploaded');
        return;
      }
      if (f.size > MAX_BYTES) {
        log('error', 'Rejected "' + f.name + '"', 'Over Radio Cult’s 750MB limit (' + mb(f.size) + ')');
        toast('danger', 'File is over the 750MB limit');
        return;
      }
    }
    file = f;
    const holder = $('filechip-holder');
    holder.innerHTML = '';
    if (f) {
      const chip = document.createElement('div');
      chip.className = 'filechip';
      const name = document.createElement('span');
      name.textContent = '♫ ' + f.name + ' · ' + mb(f.size);
      const x = document.createElement('span');
      x.className = 'x'; x.textContent = '✕'; x.title = 'Remove';
      x.addEventListener('click', (ev) => { ev.stopPropagation(); setFile(null); });
      chip.append(name, x);
      holder.appendChild(chip);
      log('info', 'Selected "' + f.name + '" (' + mb(f.size) + ')');
    }
    render();
  }
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + 'MB';

  /* ---------- upload ---------- */
  function startUpload(force) {
    if (!file || busy.upload) return;
    const meta = formMeta();
    busy.upload = true;
    $('upload-idle').classList.add('hidden');
    $('upload-busy').classList.remove('hidden');
    $('eq').classList.remove('paused');
    setProgress(0);
    log('info', (force ? 'Replacing track with' : 'Uploading') + ' "' + file.name + '" (' + mb(file.size) + ')',
      'title "' + meta.title + '" · artist "' + meta.artist + '" · album "' + meta.album + '"');

    xhr = new XMLHttpRequest();
    xhr.open('POST', '/radiocult/episodes/' + encodeURIComponent(documentId) + '/upload' + (force ? '?force=true' : ''));
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.responseType = 'json';
    xhr.timeout = 0;

    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.upload.onload = () => setProgress(null); // browser→server done; server→RC in flight

    xhr.onload = () => {
      const body = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        log('info', 'Track uploaded to Radio Cult (id ' + body.trackId + ')');
        (body.warnings || []).forEach((w) => log('warn', w));
        renderWarnings(body.warnings || []);
        toast('success', 'Episode uploaded to Radio Cult 🎉');
        setFile(null);
        finishUpload();
        fetchStatus(false);
      } else if (xhr.status === 409 && !force) {
        finishUpload();
        if (confirm((body.error || 'This episode already has a Radio Cult track.') +
            '\n\nReplace it with the new file? The old track stays in the Radio Cult library until you delete it there.')) {
          startUpload(true);
        } else {
          log('warn', 'Upload cancelled — episode already has a Radio Cult track');
        }
      } else if (xhr.status === 401) {
        finishUpload();
        handleAuthError({ status: 401 });
      } else {
        log('error', 'Upload to Radio Cult failed', (body.error || 'HTTP ' + xhr.status) + ' (HTTP ' + xhr.status + ')');
        toast('danger', 'Upload to Radio Cult failed');
        finishUpload();
      }
    };
    xhr.onerror = () => { log('error', 'Upload failed', 'Network error — is the server reachable?'); toast('danger', 'Network error during upload'); finishUpload(); };
    xhr.ontimeout = () => { log('error', 'Upload failed', 'Timed out'); finishUpload(); };
    xhr.onabort = () => { log('warn', 'Upload cancelled'); finishUpload(); };

    const fd = new FormData();
    fd.append('title', meta.title);
    fd.append('artist', meta.artist);
    fd.append('album', meta.album);
    fd.append('files', file, file.name);
    xhr.send(fd);
  }

  function setProgress(pct) {
    const bar = $('bar');
    if (pct === null) {
      bar.classList.add('indeterminate');
      $('progress-label').textContent = 'File received — Radio Cult is processing… keep this tab open.';
    } else {
      bar.classList.remove('indeterminate');
      $('bar-fill').style.width = pct + '%';
      $('progress-label').textContent = 'Sending file… ' + pct + '%';
    }
  }

  function finishUpload() {
    busy.upload = false;
    xhr = null;
    $('upload-busy').classList.add('hidden');
    $('upload-idle').classList.remove('hidden');
    $('bar-fill').style.width = '0%';
    $('bar').classList.remove('indeterminate');
    render();
  }

  function renderWarnings(warnings) {
    const box = $('upload-warnings');
    box.innerHTML = '';
    warnings.forEach((w) => {
      const div = document.createElement('div');
      div.className = 'warnline';
      div.textContent = '⚠ ' + w;
      box.appendChild(div);
    });
  }

  /* ---------- save details / publish / check ---------- */
  async function saveDetails() {
    if (busy.save) return;
    busy.save = true;
    const meta = formMeta();
    const btn = $('btn-savedetails');
    btn.disabled = true;
    try {
      await api('/radiocult/episodes/' + encodeURIComponent(documentId) + '/track', {
        method: 'PUT',
        body: JSON.stringify(meta),
      });
      log('info', 'Track details saved to Radio Cult', 'title "' + meta.title + '" · artist "' + meta.artist + '" · album "' + meta.album + '"');
      toast('success', 'Track details saved to Radio Cult');
    } catch (e) {
      if (!handleAuthError(e)) {
        log('error', 'Saving track details failed', e.message + ' (' + errDetail(e) + ')');
        toast('danger', 'Saving track details failed');
      }
    } finally {
      busy.save = false;
      btn.disabled = false;
    }
  }

  async function publish(platform, force) {
    if (busy.publish) return;
    busy.publish = platform;
    render();
    const meta = formMeta();
    const tags = formTags();
    log('info', 'Requesting ' + LABEL[platform] + ' publish', 'title "' + meta.title + '" · tags [' + tags.join(', ') + ']');
    try {
      await api('/radiocult/episodes/' + encodeURIComponent(documentId) + '/publish/' + platform + (force ? '?force=true' : ''), {
        method: 'POST',
        body: JSON.stringify({ title: meta.title, tags: tags, description: $('f-desc').value }),
      });
      log('info', LABEL[platform] + ' publish requested — Radio Cult is transferring; the link lands on the episode automatically');
      toast('success', 'Publish to ' + LABEL[platform] + ' requested');
      busy.publish = null;
      await fetchStatus(false);
    } catch (e) {
      busy.publish = null;
      if (e.status === 409 && !force) {
        if (confirm(e.message + '\n\nSend the request anyway?')) return publish(platform, true);
        log('warn', LABEL[platform] + ' publish not sent', e.message);
      } else if (!handleAuthError(e)) {
        log('error', LABEL[platform] + ' publish failed', e.message + ' (' + errDetail(e) + ')');
        toast('danger', LABEL[platform] + ' publish failed');
      }
      render();
    }
  }

  async function checkNow() {
    if (busy.check) return;
    busy.check = true;
    const btn = $('btn-check');
    btn.disabled = true;
    log('info', 'Checking Radio Cult for new links…');
    const data = await fetchStatus(true);
    if (data) {
      log('info', 'Check finished — ' + PLATFORMS.map((p) => LABEL[p] + ': ' + data.platforms[p].state.replace('_', ' ')).join(' · '));
    }
    busy.check = false;
    btn.disabled = false;
  }

  /* ---------- wiring ---------- */
  function wire() {
    const dz = $('dropzone');
    const input = $('f-file');
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => setFile(input.files[0] || null));
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

    $('btn-upload').addEventListener('click', () => startUpload(false));
    $('btn-cancel').addEventListener('click', () => { if (xhr) xhr.abort(); });
    $('btn-savedetails').addEventListener('click', saveDetails);
    $('btn-check').addEventListener('click', checkNow);
    document.querySelectorAll('.publish-btn').forEach((btn) => {
      btn.addEventListener('click', () => publish(btn.closest('.platform').dataset.platform, false));
    });

    window.addEventListener('beforeunload', (e) => {
      if (busy.upload) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    if (!documentId) {
      showNotice('No episode selected',
        'Open this page with the "Open Radio Cult uploader" button on an episode’s edit page in the Strapi admin.');
      return;
    }
    token = readToken();
    if (!token) {
      showNotice('Not logged in',
        'Log into the Strapi admin first, then reopen this page from the episode’s Radio Cult panel.');
      return;
    }
    wire();
    fetchStatus(false);
  }

  boot();
})();
