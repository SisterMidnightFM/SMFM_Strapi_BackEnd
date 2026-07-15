(function () {
  var token = new URLSearchParams(location.search).get('token');
  var apiUrl = '/api/show-edit/' + encodeURIComponent(token || '');

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

  function render(data) {
    var s = data.show;
    $('heading').textContent = 'Edit your show page: ' + (s.ShowName || '');
    $('name').value = s.ShowName || '';
    $('description').value = s.showDescriptionText || '';
    $('instagram').value = s.Show_Instagram || '';
    $('weblink1').value = s.WebLink1 || '';
    $('weblink2').value = s.WebLink2 || '';
    $('loading').style.display = 'none';
    $('form').style.display = 'block';
  }

  function save() {
    var payload = {
      ShowName: $('name').value.trim(),
      showDescriptionText: $('description').value,
      Show_Instagram: $('instagram').value.trim(),
      WebLink1: $('weblink1').value.trim(),
      WebLink2: $('weblink2').value.trim(),
    };
    if (!payload.ShowName) {
      banner('error', 'Please enter the show name.');
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
        if (res.status === 400) {
          return res.json().then(function (data) {
            throw new Error((data && data.error && data.error.message) || 'invalid');
          });
        }
        if (!res.ok) throw new Error('failed');
        banner('success', 'Saved! Your show page has been updated. You can keep editing and save again if needed.');
      })
      .catch(function (err) {
        if (err.message === 'expired') {
          banner('error', 'This link is invalid or has expired — contact the SMFM team for a new one.');
        } else if (err.message && err.message !== 'failed' && err.message !== 'invalid') {
          banner('error', err.message);
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
        fatal('Something went wrong loading your page. Please try again later.');
      }
    });
})();
