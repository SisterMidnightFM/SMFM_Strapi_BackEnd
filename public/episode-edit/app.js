(function () {
  var token = new URLSearchParams(location.search).get('token');
  var apiUrl = '/api/episode-edit/' + encodeURIComponent(token || '');

  var $ = function (id) { return document.getElementById(id); };

  function fatal(message) {
    $('loading').style.display = 'none';
    $('form').style.display = 'none';
    var el = $('fatal');
    el.textContent = message;
    el.style.display = 'block';
  }

  function banner(type, message) {
    var el = $('banner');
    el.className = 'banner show ' + type;
    el.textContent = message;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function addTrackRow(artist, title) {
    var row = document.createElement('div');
    row.className = 'track-row';

    var artistInput = document.createElement('input');
    artistInput.type = 'text';
    artistInput.placeholder = 'Artist';
    artistInput.value = artist || '';
    artistInput.className = 'track-artist';

    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Track title';
    titleInput.value = title || '';
    titleInput.className = 'track-title';

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove track');
    remove.onclick = function () { row.remove(); };

    row.appendChild(artistInput);
    row.appendChild(titleInput);
    row.appendChild(remove);
    $('tracklist').appendChild(row);
  }

  function render(data) {
    var ep = data.episode;
    $('heading').textContent = 'Edit: ' + (ep.EpisodeTitle || 'Untitled episode');
    var dateStr = ep.BroadcastDateTime
      ? new Date(ep.BroadcastDateTime).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : '';
    $('meta').textContent = (ep.showName ? ep.showName + ' — ' : '') + 'broadcast ' + dateStr;

    $('title').value = ep.EpisodeTitle || '';
    $('description').value = ep.EpisodeDescription || '';

    if (ep.Tracklist && ep.Tracklist.length) {
      ep.Tracklist.forEach(function (t) { addTrackRow(t.Artist, t.Track_Title); });
    } else {
      addTrackRow('', '');
    }

    var selected = {};
    (ep.tagGenreDocumentIds || []).forEach(function (id) { selected[id] = true; });
    data.allGenres.forEach(function (g) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = g.documentId;
      cb.checked = !!selected[g.documentId];
      label.appendChild(cb);
      label.appendChild(document.createTextNode(g.Genre || ''));
      $('genres').appendChild(label);
    });

    $('loading').style.display = 'none';
    $('form').style.display = 'block';
  }

  function collect() {
    var tracks = [];
    document.querySelectorAll('#tracklist .track-row').forEach(function (row) {
      var artist = row.querySelector('.track-artist').value.trim();
      var title = row.querySelector('.track-title').value.trim();
      if (artist || title) tracks.push({ Artist: artist, Track_Title: title });
    });
    var genreIds = [];
    document.querySelectorAll('#genres input:checked').forEach(function (cb) {
      genreIds.push(cb.value);
    });
    return {
      EpisodeTitle: $('title').value.trim(),
      EpisodeDescription: $('description').value,
      Tracklist: tracks,
      tagGenreDocumentIds: genreIds,
    };
  }

  function save() {
    var payload = collect();
    if (!payload.EpisodeTitle) {
      banner('error', 'Please enter an episode title.');
      return;
    }
    var btn = $('save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    fetch(apiUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (res.status === 401) throw new Error('expired');
        if (!res.ok) throw new Error('failed');
        banner('success', 'Saved! Your episode details have been updated. You can keep editing and save again if needed.');
      })
      .catch(function (err) {
        if (err.message === 'expired') {
          banner('error', 'This link is invalid or has expired — contact the SMFM team for a new one.');
        } else {
          banner('error', 'Something went wrong saving your changes. Please try again.');
        }
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Save changes';
      });
  }

  if (!token) {
    fatal('This page needs a valid link — please use the link from your email.');
    return;
  }

  $('add-track').onclick = function () { addTrackRow('', ''); };
  $('save').onclick = save;

  fetch(apiUrl)
    .then(function (res) {
      if (res.status === 401) throw new Error('expired');
      if (!res.ok) throw new Error('failed');
      return res.json();
    })
    .then(render)
    .catch(function (err) {
      if (err.message === 'expired') {
        fatal('This link is invalid or has expired — contact the SMFM team for a new one.');
      } else {
        fatal('Something went wrong loading your episode. Please try again later.');
      }
    });
})();
