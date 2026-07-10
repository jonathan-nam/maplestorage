(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var dropzoneLabel = document.getElementById("dropzone-label");
  var fileInput = document.getElementById("file-input");
  var uploadList = document.getElementById("upload-list");
  var archiveToggle = document.getElementById("archive-toggle");
  var archiveBody = document.getElementById("archive-body");
  var charSelectorList = document.getElementById("char-selector-list");
  var selectorClear = document.getElementById("selector-clear");
  var screenshotHelpToggle = document.getElementById("screenshot-help-toggle");
  var screenshotHelp = document.getElementById("screenshot-help");

  // Canned outcomes for the auto-detect (no pin) path — cycled deterministically
  // so repeated demos are predictable instead of random. This is the primary
  // path now: the HUD is read from every screenshot regardless of whether a
  // character is pinned, specifically so a pinned-but-wrong upload gets caught
  // as a mismatch (see nextOutcome) instead of silently misattributed — a real
  // failure mode of manual selection (forgetting to switch, or misclicking).
  var AUTO_OUTCOMES = [
    { type: "new-character", character: null, detectedName: "Nightwolf", label: "New character detected: Nightwolf — not in your roster" },
    { type: "inventory", character: "Bubbling", label: "Inventory — 5 tokens read, Bubbling" },
    { type: "inventory", character: "Squishy", label: "Inventory — 6 tokens read, Squishy" },
    { type: "inventory", character: "Nightshade", label: "Inventory — 5 tokens read, Nightshade" },
    { type: "unrecognized", character: null, label: "Unrecognized — needs review" }
  ];

  var CHARACTERS = ["Bubbling", "Squishy", "Nightshade"];
  var TYPES = ["inventory", "unrecognized"];

  var selectedCharacter = null;
  var uploadCount = 0;
  var rowCount = 0;
  var currentGroupCharacter = null;
  var timeouts = {};

  function nextOutcome() {
    if (selectedCharacter) {
      uploadCount++;
      // Every 3rd pinned upload, simulate the HUD-detected character not
      // matching the pin — demonstrates the mismatch safety net rather than
      // just asserting it exists.
      if (uploadCount % 3 === 0) {
        var others = CHARACTERS.filter(function (c) { return c !== selectedCharacter; });
        var detected = others[uploadCount % others.length];
        return {
          type: "mismatch",
          character: selectedCharacter,
          detectedCharacter: detected,
          label: "Mismatch — pinned to " + selectedCharacter + ", but this screenshot looks like " + detected
        };
      }
      var count = 4 + (uploadCount % 6);
      return {
        type: "inventory",
        character: selectedCharacter,
        label: "Inventory — " + count + " tokens read, " + selectedCharacter
      };
    }
    var outcome = AUTO_OUTCOMES[uploadCount % AUTO_OUTCOMES.length];
    uploadCount++;
    return outcome;
  }

  function ensureGroupHeader(character) {
    if (character && character !== currentGroupCharacter) {
      var header = document.createElement("div");
      header.className = "session-header";
      header.textContent = character;
      uploadList.appendChild(header);
      currentGroupCharacter = character;
    }
  }

  function scheduleResolve(rowId, statusEl, outcome) {
    if (timeouts[rowId]) {
      clearTimeout(timeouts[rowId]);
    }
    statusEl.textContent = "Detecting…";
    statusEl.className = "status pending";
    timeouts[rowId] = setTimeout(function () {
      statusEl.textContent = outcome.label;
      statusEl.className = "status " + (
        outcome.type === "unrecognized" ? "needs-review" :
        outcome.type === "mismatch" ? "mismatch" :
        outcome.type === "new-character" ? "new-character" : ""
      );
      delete timeouts[rowId];
    }, 700 + Math.random() * 800);
  }

  function toggleChangePanel(row, statusEl, outcome) {
    var existing = row.nextElementSibling;
    if (existing && existing.classList && existing.classList.contains("change-panel")) {
      existing.remove();
      return;
    }

    var panel = document.createElement("div");
    panel.className = "change-panel";

    var typeLabel = document.createElement("label");
    typeLabel.textContent = "Type: ";
    var typeSelect = document.createElement("select");
    TYPES.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === outcome.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeLabel.appendChild(typeSelect);

    var charLabel = document.createElement("label");
    charLabel.textContent = "Character: ";
    var charSelect = document.createElement("select");
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(none)";
    charSelect.appendChild(noneOpt);
    // For a mismatch, default the picker to the HUD-detected character, not
    // the (wrong) pinned one — the likely fix is one click away instead of
    // requiring the user to also remember who it should have been.
    var preselectCharacter = outcome.detectedCharacter || outcome.character;
    CHARACTERS.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === preselectCharacter) opt.selected = true;
      charSelect.appendChild(opt);
    });
    charLabel.appendChild(charSelect);

    function applyManualOverride() {
      var t = typeSelect.value;
      var c = charSelect.value;
      if (t === "unrecognized" || !c) {
        statusEl.textContent = "Unrecognized — needs review";
        statusEl.className = "status needs-review";
      } else {
        statusEl.textContent = "Inventory — manually assigned, " + c;
        statusEl.className = "status";
      }
    }

    typeSelect.addEventListener("change", applyManualOverride);
    charSelect.addEventListener("change", applyManualOverride);

    panel.appendChild(typeLabel);
    panel.appendChild(charLabel);
    row.parentNode.insertBefore(panel, row.nextSibling);
  }

  // A detected character with no roster match is never auto-created — a
  // single unverified vision read becoming a permanent roster entry is the
  // same risk we already rejected for auto-discovering item catalog entries.
  // Instead: a one-click confirm that runs the same Nexon-lookup enrichment
  // manual add would, plus an escape hatch in case the "new" name is really
  // just a misread of a character that already exists.
  function buildNewCharacterActions(actions, row, statusEl, outcome, rowId) {
    var addLink = document.createElement("a");
    addLink.href = "#";
    addLink.textContent = "[add " + outcome.detectedName + "]";
    addLink.addEventListener("click", function (e) {
      e.preventDefault();
      confirmAddCharacter(outcome.detectedName, statusEl, actions, rowId);
    });

    var pickLink = document.createElement("a");
    pickLink.href = "#";
    pickLink.textContent = "[pick existing character]";
    pickLink.addEventListener("click", function (e) {
      e.preventDefault();
      toggleChangePanel(row, statusEl, { type: "inventory", character: null });
    });

    var ignoreLink = document.createElement("a");
    ignoreLink.href = "#";
    ignoreLink.textContent = "[ignore]";
    ignoreLink.addEventListener("click", function (e) {
      e.preventDefault();
      if (timeouts[rowId]) {
        clearTimeout(timeouts[rowId]);
        delete timeouts[rowId];
      }
      statusEl.textContent = "Ignored — not added";
      statusEl.className = "status needs-review";
      actions.innerHTML = "";
    });

    actions.appendChild(addLink);
    actions.appendChild(pickLink);
    actions.appendChild(ignoreLink);
  }

  function confirmAddCharacter(name, statusEl, actions, rowId) {
    if (timeouts[rowId]) {
      clearTimeout(timeouts[rowId]);
      delete timeouts[rowId];
    }
    statusEl.textContent = "Adding " + name + "… looking up level/job/sprite";
    statusEl.className = "status pending";
    actions.innerHTML = "";
    setTimeout(function () {
      addCharacterToSelector(name);
      statusEl.textContent = "Inventory — 8 tokens read, " + name;
      statusEl.className = "status";
    }, 900);
  }

  function addCharacterToSelector(name) {
    if (CHARACTERS.indexOf(name) !== -1) return;
    CHARACTERS.push(name);

    var item = document.createElement("div");
    item.className = "char-selector-item";
    item.dataset.name = name;

    var placeholder = document.createElement("div");
    placeholder.className = "selector-sprite selector-sprite-placeholder";

    var nameSpan = document.createElement("span");
    nameSpan.className = "selector-name";
    nameSpan.textContent = name;

    item.appendChild(placeholder);
    item.appendChild(nameSpan);
    item.addEventListener("click", function () {
      selectCharacter(item.dataset.name, item);
    });

    charSelectorList.appendChild(item);
  }

  function addRow(file) {
    var outcome = nextOutcome();
    ensureGroupHeader(outcome.character);

    var rowId = "row-" + rowCount++;
    var row = document.createElement("div");
    row.className = "upload-row";
    row.id = rowId;

    var thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = URL.createObjectURL(file);
    thumb.alt = "";

    var filename = document.createElement("span");
    filename.className = "filename";
    filename.textContent = file.name;

    var status = document.createElement("span");
    status.className = "status pending";
    status.textContent = "Detecting…";

    var actions = document.createElement("span");
    actions.className = "row-actions";

    if (outcome.type === "new-character") {
      buildNewCharacterActions(actions, row, status, outcome, rowId);
    } else {
      var changeLink = document.createElement("a");
      changeLink.href = "#";
      changeLink.textContent = "[change]";
      changeLink.addEventListener("click", function (e) {
        e.preventDefault();
        toggleChangePanel(row, status, outcome);
      });

      var retryLink = document.createElement("a");
      retryLink.href = "#";
      retryLink.textContent = "[retry]";
      retryLink.addEventListener("click", function (e) {
        e.preventDefault();
        scheduleResolve(rowId, status, outcome);
      });

      actions.appendChild(changeLink);
      actions.appendChild(retryLink);
    }

    row.appendChild(thumb);
    row.appendChild(filename);
    row.appendChild(status);
    row.appendChild(actions);

    uploadList.appendChild(row);
    scheduleResolve(rowId, status, outcome);
  }

  function handleFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (file) {
      if (file.type.indexOf("image/") === 0) {
        addRow(file);
      }
    });
  }

  // --- Character selector -------------------------------------------------

  function updateDropzoneLabel() {
    if (selectedCharacter) {
      dropzoneLabel.textContent = "Drag " + selectedCharacter + "'s screenshot here, or click to browse";
      selectorClear.hidden = false;
    } else {
      dropzoneLabel.textContent = "Drag screenshots here, or click to browse";
      selectorClear.hidden = true;
    }
  }

  function selectCharacter(name, itemEl) {
    var alreadySelected = selectedCharacter === name;
    Array.prototype.forEach.call(
      charSelectorList.querySelectorAll(".char-selector-item"),
      function (el) { el.classList.remove("selected"); }
    );
    if (alreadySelected) {
      selectedCharacter = null;
    } else {
      selectedCharacter = name;
      itemEl.classList.add("selected");
    }
    updateDropzoneLabel();
  }

  Array.prototype.forEach.call(
    charSelectorList.querySelectorAll(".char-selector-item"),
    function (item) {
      item.addEventListener("click", function () {
        selectCharacter(item.dataset.name, item);
      });
    }
  );

  selectorClear.addEventListener("click", function (e) {
    e.preventDefault();
    selectedCharacter = null;
    Array.prototype.forEach.call(
      charSelectorList.querySelectorAll(".char-selector-item"),
      function (el) { el.classList.remove("selected"); }
    );
    updateDropzoneLabel();
  });

  // --- Screenshot help (OS-aware) -----------------------------------------

  var STEPS_BY_OS = {
    mac: [
      "Press Cmd + Shift + 4.",
      "Drag a box around the boss-planner or inventory panel — it saves a PNG to your desktop automatically.",
      "Drag that file into the drop zone below (or click the drop zone to browse for it)."
    ],
    windows: [
      "Press Windows key + Shift + S.",
      "Drag a box around the boss-planner or inventory panel — it's copied to your clipboard.",
      "Click anywhere on this page and press Ctrl+V to paste it directly — no need to save a file first."
    ],
    unknown: [
      "Use your OS's screenshot shortcut (Windows: Win+Shift+S, Mac: Cmd+Shift+4) to capture the boss-planner or inventory panel.",
      "If it's copied to your clipboard, click this page and press Ctrl/Cmd+V to paste it directly.",
      "Otherwise, drag the saved image file into the drop zone below."
    ]
  };

  // Detection, best-effort first: User-Agent Client Hints (navigator.userAgentData)
  // is the modern, purpose-built replacement for UA sniffing — but it's
  // Chromium-only (Chrome/Edge/Opera), not implemented in Firefox or Safari.
  // Fall back to parsing navigator.userAgent for those. navigator.platform is
  // deliberately NOT used here — it's deprecated and increasingly unreliable
  // (some browsers now return generic values for fingerprinting resistance).
  // Either way, auto-detect is just the default — the manual toggle below is
  // what actually makes a wrong guess recoverable rather than silently wrong.
  function detectOS() {
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      var p = navigator.userAgentData.platform;
      if (/mac/i.test(p)) return "mac";
      if (/win/i.test(p)) return "windows";
      return "unknown";
    }
    var ua = navigator.userAgent || "";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    if (/Windows NT/i.test(ua)) return "windows";
    return "unknown";
  }

  var currentHelpOS = detectOS();

  function renderScreenshotHelp() {
    var steps = STEPS_BY_OS[currentHelpOS] || STEPS_BY_OS.unknown;
    screenshotHelp.innerHTML = "";

    var toggle = document.createElement("p");
    toggle.className = "os-toggle";
    toggle.appendChild(document.createTextNode("Showing instructions for: "));
    ["windows", "mac"].forEach(function (os, i) {
      if (i > 0) toggle.appendChild(document.createTextNode(" | "));
      var link = document.createElement("a");
      link.href = "#";
      link.textContent = os === "windows" ? "Windows" : "Mac";
      if (os === currentHelpOS) link.className = "active";
      link.addEventListener("click", function (e) {
        e.preventDefault();
        currentHelpOS = os;
        renderScreenshotHelp();
      });
      toggle.appendChild(link);
    });
    screenshotHelp.appendChild(toggle);

    var list = document.createElement("ol");
    steps.forEach(function (step) {
      var li = document.createElement("li");
      li.textContent = step;
      list.appendChild(li);
    });
    screenshotHelp.appendChild(list);
  }

  screenshotHelpToggle.addEventListener("click", function (e) {
    e.preventDefault();
    if (screenshotHelp.hidden) {
      renderScreenshotHelp();
      screenshotHelp.hidden = false;
      screenshotHelpToggle.textContent = "Hide instructions";
    } else {
      screenshotHelp.hidden = true;
      screenshotHelpToggle.textContent = "Show me how";
    }
  });

  // --- Drop / browse / paste -----------------------------------------------

  dropzone.addEventListener("click", function () {
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    handleFiles(fileInput.files);
    fileInput.value = "";
  });

  dropzone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    handleFiles(e.dataTransfer.files);
  });

  // Paste-to-upload: a screenshot copied to the clipboard (e.g. Win+Shift+S)
  // can be dropped straight in with Ctrl/Cmd+V — skips the "save a file,
  // then find it, then drag it" steps entirely.
  document.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var files = [];
    Array.prototype.forEach.call(items, function (item) {
      if (item.kind === "file" && item.type.indexOf("image/") === 0) {
        var file = item.getAsFile();
        if (file) files.push(file);
      }
    });
    if (files.length > 0) {
      handleFiles(files);
    }
  });

  archiveToggle.addEventListener("click", function (e) {
    e.preventDefault();
    var isHidden = archiveBody.hasAttribute("hidden");
    if (isHidden) {
      archiveBody.removeAttribute("hidden");
      archiveToggle.textContent = "▾ Today (2)";
    } else {
      archiveBody.setAttribute("hidden", "");
      archiveToggle.textContent = "▸ Today (2)";
    }
  });
})();
