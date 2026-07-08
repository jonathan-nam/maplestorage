(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var uploadList = document.getElementById("upload-list");
  var archiveToggle = document.getElementById("archive-toggle");
  var archiveBody = document.getElementById("archive-body");

  // Canned outcomes cycled deterministically per drop, so repeated demos
  // are predictable instead of random.
  var OUTCOMES = [
    { type: "inventory", character: "Bubbling", label: "Inventory — 7 tokens read, Bubbling" },
    { type: "inventory", character: "Squishy", label: "Inventory — 6 tokens read, Squishy" },
    { type: "inventory", character: "Nightshade", label: "Inventory — 5 tokens read, Nightshade" },
    { type: "unrecognized", character: null, label: "Unrecognized — needs review" }
  ];

  var CHARACTERS = ["Bubbling", "Squishy", "Nightshade"];
  var TYPES = ["inventory", "unrecognized"];

  var uploadCount = 0;
  var rowCount = 0;
  var currentGroupCharacter = null;
  var timeouts = {};

  function nextOutcome() {
    var outcome = OUTCOMES[uploadCount % OUTCOMES.length];
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
      statusEl.className = outcome.type === "unrecognized" ? "status needs-review" : "status";
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
    CHARACTERS.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === outcome.character) opt.selected = true;
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
