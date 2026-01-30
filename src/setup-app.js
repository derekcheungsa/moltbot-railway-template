// Served at /setup/app.js
// No fancy syntax: keep it maximally compatible.

(function () {
  var statusEl = document.getElementById('status');
  var authGroupEl = document.getElementById('authGroup');
  var authChoiceEl = document.getElementById('authChoice');
  var logEl = document.getElementById('log');

  function setStatus(s) {
    statusEl.textContent = s;
  }

  // Provider template handling
  window.useProvider = function(providerId) {
    httpJson('/setup/api/templates/' + providerId)
      .then(function(tmpl) {
        // Set auth choice
        if (tmpl.authChoice) {
          authChoiceEl.value = tmpl.authChoice;
          // Trigger change to update options if needed
          if (authGroupEl) {
            authGroupEl.value = tmpl.authChoice.split('-')[0] || tmpl.authChoice;
            authGroupEl.dispatchEvent(new Event('change'));
          }
        }

        // Set placeholders and help text
        var authSecretEl = document.getElementById('authSecret');
        if (authSecretEl && tmpl.fields.authSecret) {
          authSecretEl.placeholder = tmpl.fields.authSecret.placeholder || '';
          var helpEl = document.getElementById('authSecretHelp');
          if (helpEl) {
            helpEl.textContent = tmpl.fields.authSecret.help || '';
            helpEl.style.display = 'block';
          }
        }

        // Set base URL if provided
        if (tmpl.fields.baseUrl && tmpl.fields.baseUrl.default) {
          var baseUrlEl = document.getElementById('baseUrl');
          if (baseUrlEl) {
            baseUrlEl.value = tmpl.fields.baseUrl.default;
          }
        }

        logEl.textContent += '\nSelected provider: ' + tmpl.name + '\n';
      })
      .catch(function(err) {
        logEl.textContent += '\nError loading template: ' + String(err) + '\n';
      });
  };

  // Validate token on blur
  window.validateToken = function() {
    var authChoice = authChoiceEl.value;
    var token = document.getElementById('authSecret').value.trim();
    var baseUrl = document.getElementById('baseUrl') ? document.getElementById('baseUrl').value.trim() : '';

    if (!authChoice || !token) {
      return;
    }

    var validateBtn = document.getElementById('validateBtn');
    if (validateBtn) {
      validateBtn.textContent = 'Validating...';
      validateBtn.disabled = true;
    }

    httpJson('/setup/api/validate-token', {
      method: 'POST',
      body: JSON.stringify({ provider: authChoice, token: token, baseUrl: baseUrl })
    }).then(function(result) {
      if (validateBtn) {
        validateBtn.textContent = result.valid ? '✓ Valid' : '✗ Invalid';
        validateBtn.disabled = false;
        validateBtn.style.backgroundColor = result.valid ? '#28a745' : '#dc3545';
      }

      var msg = result.valid ? 'Token validated successfully for ' + result.provider : 'Validation failed: ' + result.error;
      logEl.textContent += '\n' + msg + '\n';
    }).catch(function(err) {
      if (validateBtn) {
        validateBtn.textContent = 'Validate Token';
        validateBtn.disabled = false;
      }
      logEl.textContent += '\nValidation error: ' + String(err) + '\n';
    });
  };

  // Pre-flight checks
  window.runPreflightChecks = function() {
    var resultsEl = document.getElementById('preflightResults');
    resultsEl.innerHTML = 'Running checks...';
    resultsEl.style.color = '#555';

    httpJson('/setup/api/check')
      .then(function(data) {
        var html = '<div style="margin-top:0.75rem">';
        html += '<strong>' + data.summary + '</strong><br><br>';

        data.checks.forEach(function(check) {
          var icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
          var color = check.status === 'ok' ? '#28a745' : check.status === 'warning' ? '#ffc107' : '#dc3545';
          html += '<div style="margin:0.25rem 0; color:' + color + '">';
          html += icon + ' <strong>' + check.name + ':</strong> ' + check.message;
          html += '</div>';
        });

        html += '</div>';
        resultsEl.innerHTML = html;
      })
      .catch(function(err) {
        resultsEl.innerHTML = '<div style="color:#dc3545; margin-top:0.75rem;">Error: ' + String(err) + '</div>';
      });
  };

  function renderAuth(groups) {
    authGroupEl.innerHTML = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var opt = document.createElement('option');
      opt.value = g.value;
      opt.textContent = g.label + (g.hint ? ' - ' + g.hint : '');
      authGroupEl.appendChild(opt);
    }

    authGroupEl.onchange = function () {
      var sel = null;
      for (var j = 0; j < groups.length; j++) {
        if (groups[j].value === authGroupEl.value) sel = groups[j];
      }
      authChoiceEl.innerHTML = '';
      var opts = (sel && sel.options) ? sel.options : [];
      for (var k = 0; k < opts.length; k++) {
        var o = opts[k];
        var opt2 = document.createElement('option');
        opt2.value = o.value;
        opt2.textContent = o.label + (o.hint ? ' - ' + o.hint : '');
        authChoiceEl.appendChild(opt2);
      }
    };

    authGroupEl.onchange();
  }

  function httpJson(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ': ' + (t || res.statusText));
        });
      }
      return res.json();
    });
  }

  function refreshStatus() {
    setStatus('Loading...');
    return httpJson('/setup/api/status').then(function (j) {
      var ver = j.moltbotVersion ? (' | ' + j.moltbotVersion) : '';
      setStatus((j.configured ? 'Configured - open /moltbot' : 'Not configured - run setup below') + ver);
      renderAuth(j.authGroups || []);
      // If channels are unsupported, surface it for debugging.
      if (j.channelsAddHelp && j.channelsAddHelp.indexOf('telegram') === -1) {
        logEl.textContent += '\nNote: this moltbot build does not list telegram in `channels add --help`. Telegram auto-add will be skipped.\n';
      }

    }).catch(function (e) {
      setStatus('Error: ' + String(e));
    });
  }

  document.getElementById('run').onclick = function () {
    var payload = {
      flow: document.getElementById('flow').value,
      authChoice: authChoiceEl.value,
      authSecret: document.getElementById('authSecret').value,
      telegramToken: document.getElementById('telegramToken').value,
      discordToken: document.getElementById('discordToken').value,
      slackBotToken: document.getElementById('slackBotToken').value,
      slackAppToken: document.getElementById('slackAppToken').value
    };

    logEl.textContent = 'Running...\n';

    fetch('/setup/api/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var j;
      try { j = JSON.parse(text); } catch (_e) { j = { ok: false, output: text }; }
      logEl.textContent += (j.output || JSON.stringify(j, null, 2));
      return refreshStatus();
    }).catch(function (e) {
      logEl.textContent += '\nError: ' + String(e) + '\n';
    });
  };

  // Pairing approve helper
  var pairingBtn = document.getElementById('pairingApprove');
  if (pairingBtn) {
    pairingBtn.onclick = function () {
      var channel = prompt('Enter channel (telegram or discord):');
      if (!channel) return;
      channel = channel.trim().toLowerCase();
      if (channel !== 'telegram' && channel !== 'discord') {
        alert('Channel must be "telegram" or "discord"');
        return;
      }
      var code = prompt('Enter pairing code (e.g. 3EY4PUYS):');
      if (!code) return;
      logEl.textContent += '\nApproving pairing for ' + channel + '...\n';
      fetch('/setup/api/pairing/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: channel, code: code.trim() })
      }).then(function (r) { return r.text(); })
        .then(function (t) { logEl.textContent += t + '\n'; })
        .catch(function (e) { logEl.textContent += 'Error: ' + String(e) + '\n'; });
    };
  }

  document.getElementById('reset').onclick = function () {
    if (!confirm('Reset setup? This deletes the config file so onboarding can run again.')) return;
    logEl.textContent = 'Resetting...\n';
    fetch('/setup/api/reset', { method: 'POST', credentials: 'same-origin' })
      .then(function (res) { return res.text(); })
      .then(function (t) { logEl.textContent += t + '\n'; return refreshStatus(); })
      .catch(function (e) { logEl.textContent += 'Error: ' + String(e) + '\n'; });
  };

  // Debug button handler
  var debugBtn = document.getElementById('debug');
  if (debugBtn) {
    debugBtn.onclick = function () {
      logEl.textContent = 'Fetching debug info...\n';
      httpJson('/setup/api/debug')
        .then(function (info) {
          // Check for error response
          if (info.error) {
            logEl.textContent = 'ERROR: ' + info.error + '\n';
            if (info.stack) {
              logEl.textContent += 'Stack: ' + info.stack + '\n';
            }
            return;
          }

          logEl.textContent = 'DEBUG INFO:\n';
          logEl.textContent += '================\n';
          logEl.textContent += 'Configured: ' + info.configured + '\n';
          logEl.textContent += 'Config path: ' + info.configPath + '\n';
          logEl.textContent += 'Config exists: ' + info.configExists + '\n';
          logEl.textContent += 'State dir: ' + info.stateDir + ' (exists: ' + info.stateDirExists + ')\n';
          logEl.textContent += 'Workspace dir: ' + info.workspaceDir + ' (exists: ' + info.workspaceDirExists + ')\n';
          logEl.textContent += 'Gateway running: ' + info.gatewayRunning + '\n';
          logEl.textContent += 'Gateway proc exists: ' + info.gatewayProcExists + '\n';
          logEl.textContent += 'Gateway proc PID: ' + info.gatewayProcPid + '\n';
          if (info.configContent) {
            logEl.textContent += '\nConfig content:\n' + JSON.stringify(info.configContent, null, 2) + '\n';
          } else if (info.configError) {
            logEl.textContent += '\nConfig error: ' + info.configError + '\n';
          }
          logEl.textContent += '================\n';
        })
        .catch(function (e) { logEl.textContent += 'Error: ' + String(e) + '\n'; });
    };
  }

  // Test endpoint button handler
  var testBtn = document.getElementById('test');
  if (testBtn) {
    testBtn.onclick = function () {
      logEl.textContent = 'Testing endpoint...\n';
      httpJson('/setup/api/test')
        .then(function (result) {
          logEl.textContent = 'TEST RESULT:\n';
          logEl.textContent += '============\n';
          logEl.textContent += JSON.stringify(result, null, 2) + '\n';
          logEl.textContent += '============\n';
          if (result.test === 'ok') {
            logEl.textContent += '\n✅ Routing and authentication work!\n';
          }
        })
        .catch(function (e) { logEl.textContent += 'Error: ' + String(e) + '\n'; });
    };
  }

  refreshStatus();

  // Run pre-flight checks on load
  setTimeout(function() {
    runPreflightChecks();
  }, 500);
})();
