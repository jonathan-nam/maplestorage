(function () {
  "use strict";

  var addToggle = document.getElementById("add-toggle");
  var addPanel = document.getElementById("add-panel");
  var searchInput = document.getElementById("search-input");
  var searchSubmit = document.getElementById("search-submit");
  var addCancel = document.getElementById("add-cancel");
  var searchResults = document.getElementById("search-results");
  var manualFallback = document.getElementById("manual-fallback");
  var itemRows = document.getElementById("item-rows");

  // The real in-game inventory tabs (see reference-images/inventory sample.png),
  // not an app-invented scheme — maplestory.io's own overallCategory values
  // line up with these directly (see PLAN.md's "Item catalog & icon references").
  var CATEGORIES = ["EQUIP", "USE", "ETC", "SETUP", "CASH", "DEC"];

  // Canned stand-ins for the live maplestory.io search call — chosen to
  // demonstrate the three real outcomes found during that research: a clean
  // single match, multiple candidates sharing one name, and a match with an
  // unclassified category.
  var FAKE_SEARCH = [
    {
      test: function (q) { return q.indexOf("wealth") !== -1; },
      hint: "Multiple items share this exact name — compare icons/ids carefully before choosing.",
      results: [
        { id: 2003551, name: "Wealth Acquisition Potion", category: "USE", meta: "Use / Consumable / Potion", icon: "assets/icon-wealth-potion.png" },
        { id: 2003559, name: "Wealth Acquisition Potion", category: "USE", meta: "Use / Consumable / Potion", icon: "assets/icon-wealth-potion.png" },
        { id: 2003575, name: "Wealth Acquisition Potion", category: "USE", meta: "Use / Consumable / Potion", icon: "assets/icon-wealth-potion.png" }
      ]
    },
    {
      test: function (q) { return q.indexOf("sunday") !== -1 || q.indexOf("growth") !== -1; },
      results: [
        { id: 2434745, name: "Sunday's Growth Box", category: "USE", meta: "Use / Consumable / Other", icon: "assets/icon-growth-box.png" }
      ]
    },
    {
      test: function (q) { return q.indexOf("kalos") !== -1; },
      results: [
        { id: 2634472, name: "Kalos's Residual Determination", category: null, meta: "Not yet classified by the source database", icon: "assets/icon-kalos-token.png", redemption: "collect 10 → Eternal set" }
      ]
    },
    {
      test: function (q) { return q.indexOf("potion") !== -1; },
      results: [
        { id: 2000002, name: "White Potion", category: "USE", meta: "Use / Consumable / Potion", icon: "assets/icon-white-potion.png" }
      ]
    }
  ];

  function runSearch(query) {
    var q = query.trim().toLowerCase();
    if (!q) return { hint: null, results: [] };
    for (var i = 0; i < FAKE_SEARCH.length; i++) {
      if (FAKE_SEARCH[i].test(q)) {
        return { hint: FAKE_SEARCH[i].hint || null, results: FAKE_SEARCH[i].results };
      }
    }
    return { hint: null, results: [] };
  }

  function openPanel() {
    addPanel.hidden = false;
    searchInput.focus();
  }

  function closePanel() {
    addPanel.hidden = true;
    searchInput.value = "";
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    manualFallback.hidden = true;
    manualFallback.innerHTML = "";
  }

  function ensureCategoryHeader(category) {
    var existing = itemRows.querySelector('tr.category-header[data-category="' + category + '"]');
    if (existing) return;
    var header = document.createElement("tr");
    header.className = "category-header";
    header.dataset.category = category;
    var td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = category;
    header.appendChild(td);
    itemRows.appendChild(header);
  }

  function addItemRow(category, name, iconSrc, redemptionNote) {
    ensureCategoryHeader(category);
    var row = document.createElement("tr");
    row.dataset.name = name;

    var iconCell = document.createElement("td");
    if (iconSrc) {
      var img = document.createElement("img");
      img.className = "icon";
      img.src = iconSrc;
      img.alt = "";
      iconCell.appendChild(img);
    } else {
      var placeholder = document.createElement("div");
      placeholder.className = "icon icon-placeholder";
      iconCell.appendChild(placeholder);
    }

    var nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    nameCell.appendChild(document.createTextNode(name + " "));
    if (redemptionNote) {
      var badge = document.createElement("span");
      badge.className = "redemption-note";
      badge.textContent = redemptionNote;
      nameCell.appendChild(badge);
    }

    var actionsCell = document.createElement("td");
    actionsCell.className = "row-actions";
    var removeLink = document.createElement("a");
    removeLink.href = "#";
    removeLink.className = "remove-link";
    removeLink.textContent = "[remove]";
    removeLink.addEventListener("click", function (e) {
      e.preventDefault();
      row.remove();
    });
    actionsCell.appendChild(removeLink);

    row.appendChild(iconCell);
    row.appendChild(nameCell);
    row.appendChild(actionsCell);
    itemRows.appendChild(row);
  }

  function renderCandidateRow(candidate) {
    var row = document.createElement("div");
    row.className = "candidate-row";

    var img = document.createElement("img");
    img.className = "icon";
    img.src = candidate.icon;
    img.alt = "";

    var info = document.createElement("div");
    info.className = "candidate-info";
    var nameEl = document.createElement("span");
    nameEl.className = "candidate-name";
    nameEl.textContent = candidate.name + " (id " + candidate.id + ")";
    var metaEl = document.createElement("span");
    metaEl.className = "candidate-meta" + (candidate.category ? "" : " needs-review");
    metaEl.textContent = candidate.meta;
    info.appendChild(nameEl);
    info.appendChild(metaEl);

    var actions = document.createElement("div");
    var useLink = document.createElement("a");
    useLink.href = "#";
    useLink.textContent = "[use this]";

    useLink.addEventListener("click", function (e) {
      e.preventDefault();
      if (candidate.category) {
        addItemRow(candidate.category, candidate.name, candidate.icon, candidate.redemption);
        closePanel();
      } else {
        var existingPicker = row.nextElementSibling;
        if (existingPicker && existingPicker.classList.contains("category-picker")) {
          existingPicker.remove();
          return;
        }
        var picker = document.createElement("div");
        picker.className = "category-picker";
        var label = document.createElement("label");
        label.textContent = "Assign category: ";
        var select = document.createElement("select");
        CATEGORIES.forEach(function (c) {
          var opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          select.appendChild(opt);
        });
        label.appendChild(select);
        var confirmLink = document.createElement("a");
        confirmLink.href = "#";
        confirmLink.textContent = "[confirm]";
        confirmLink.addEventListener("click", function (ce) {
          ce.preventDefault();
          addItemRow(select.value, candidate.name, candidate.icon, candidate.redemption);
          closePanel();
        });
        picker.appendChild(label);
        picker.appendChild(confirmLink);
        row.parentNode.insertBefore(picker, row.nextSibling);
      }
    });

    actions.appendChild(useLink);
    row.appendChild(img);
    row.appendChild(info);
    row.appendChild(actions);
    return row;
  }

  function renderManualFallback(query) {
    manualFallback.innerHTML = "";
    manualFallback.hidden = false;

    var noMatch = document.createElement("p");
    noMatch.className = "no-match";
    noMatch.textContent = 'No match found in the item database for "' + query + '". Add it manually:';
    manualFallback.appendChild(noMatch);

    var nameLabel = document.createElement("label");
    nameLabel.textContent = "Name: ";
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = query;
    nameLabel.appendChild(nameInput);
    manualFallback.appendChild(nameLabel);

    var catLabel = document.createElement("label");
    catLabel.textContent = "Category: ";
    var catSelect = document.createElement("select");
    CATEGORIES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      catSelect.appendChild(opt);
    });
    catLabel.appendChild(catSelect);
    manualFallback.appendChild(catLabel);

    var dropzone = document.createElement("div");
    dropzone.className = "mini-dropzone";
    dropzone.textContent = "Drop a cropped icon here, or click to browse";
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    var chosenIconSrc = null;

    function showPreview(file) {
      chosenIconSrc = URL.createObjectURL(file);
      dropzone.innerHTML = "";
      var img = document.createElement("img");
      img.src = chosenIconSrc;
      dropzone.appendChild(img);
    }

    dropzone.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      if (fileInput.files[0]) showPreview(fileInput.files[0]);
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
      if (e.dataTransfer.files[0]) showPreview(e.dataTransfer.files[0]);
    });

    manualFallback.appendChild(dropzone);
    manualFallback.appendChild(fileInput);

    var addLink = document.createElement("a");
    addLink.href = "#";
    addLink.textContent = "[add item]";
    addLink.addEventListener("click", function (e) {
      e.preventDefault();
      var name = nameInput.value.trim();
      if (!name) return;
      addItemRow(catSelect.value, name, chosenIconSrc);
      closePanel();
    });
    manualFallback.appendChild(addLink);
  }

  function doSearch() {
    var query = searchInput.value;
    var outcome = runSearch(query);

    manualFallback.hidden = true;
    manualFallback.innerHTML = "";
    searchResults.innerHTML = "";

    if (outcome.results.length === 0) {
      searchResults.hidden = true;
      renderManualFallback(query.trim());
      return;
    }

    searchResults.hidden = false;
    if (outcome.hint) {
      var hint = document.createElement("p");
      hint.className = "search-hint";
      hint.textContent = outcome.hint;
      searchResults.appendChild(hint);
    }
    outcome.results.forEach(function (candidate) {
      searchResults.appendChild(renderCandidateRow(candidate));
    });
  }

  addToggle.addEventListener("click", function (e) {
    e.preventDefault();
    if (addPanel.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  addCancel.addEventListener("click", function (e) {
    e.preventDefault();
    closePanel();
  });

  searchSubmit.addEventListener("click", function (e) {
    e.preventDefault();
    doSearch();
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });

  // Wire up [remove] for the statically-seeded rows.
  Array.prototype.forEach.call(itemRows.querySelectorAll("tr:not(.category-header) .remove-link"), function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      link.closest("tr").remove();
    });
  });
})();
