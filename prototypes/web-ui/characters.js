(function () {
  "use strict";

  var addToggle = document.getElementById("add-toggle");
  var addForm = document.getElementById("add-form");
  var addName = document.getElementById("add-name");
  var addSubmit = document.getElementById("add-submit");
  var addCancel = document.getElementById("add-cancel");
  var charGrid = document.getElementById("char-grid");

  // Fake lookup + fake mini-inventory, standing in for the real Nexon lookup
  // (see PLAN.md) and real per-character item counts (see WEB-UI-SPEC.md's
  // Items page), neither of which are callable/queryable from a static
  // file:// prototype. The "highest priority" items shown per tile are just
  // whatever's listed here for the demo — the real selection rule (e.g.
  // tokens closest to a redemption threshold, low-stock potions) is still open.
  var FAKE_LOOKUPS = [
    { sprite: "assets/bubbling.png", level: 285, job: "Hoyoung",
      items: [ { icon: "assets/icon-kalos-token.png", qty: 7 }, { icon: "assets/icon-white-potion.png", qty: 12 }, { icon: "assets/icon-wealth-potion.png", qty: 2 } ] },
    { sprite: "assets/squishy.png", level: 271, job: "Bow Master",
      items: [ { icon: "assets/icon-growth-box.png", qty: 1 }, { icon: "assets/icon-white-potion.png", qty: 45 } ] },
    { sprite: "assets/nightshade.png", level: 299, job: "Hero",
      items: [ { icon: "assets/icon-kalos-token.png", qty: 10 }, { icon: "assets/icon-wealth-potion.png", qty: 5 }, { icon: "assets/icon-growth-box.png", qty: 3 } ] }
  ];
  var lookupIndex = FAKE_LOOKUPS.length; // the static tiles already used indices 0..2

  function openForm() {
    addForm.hidden = false;
    addName.focus();
  }

  function closeForm() {
    addForm.hidden = true;
    addName.value = "";
  }

  function makeMiniInventory(items) {
    var wrap = document.createElement("div");
    wrap.className = "mini-inventory";
    items.forEach(function (item) {
      var span = document.createElement("span");
      span.className = "mini-item";
      var img = document.createElement("img");
      img.src = item.icon;
      img.alt = "";
      var b = document.createElement("b");
      b.textContent = item.qty;
      span.appendChild(img);
      span.appendChild(b);
      wrap.appendChild(span);
    });
    return wrap;
  }

  function makeAction(label) {
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = label;
    a.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    return a;
  }

  function makeRefreshAction(updatedEl) {
    var a = document.createElement("a");
    a.href = "#";
    a.className = "refresh-link";
    a.textContent = "[refresh]";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      updatedEl.textContent = "refreshing…";
      setTimeout(function () {
        updatedEl.textContent = "updated just now";
      }, 900);
    });
    return a;
  }

  function makeDeleteAction(tile) {
    var a = document.createElement("a");
    a.href = "#";
    a.className = "delete-link";
    a.textContent = "[delete]";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      tile.remove();
    });
    return a;
  }

  function wireTileNav(tile) {
    tile.addEventListener("click", function () {
      window.location.href = "character-detail.html?char=" + encodeURIComponent(tile.dataset.char);
    });
  }

  function addTile(name) {
    var lookup = FAKE_LOOKUPS[lookupIndex % FAKE_LOOKUPS.length];
    lookupIndex++;

    var tile = document.createElement("div");
    tile.className = "char-tile";
    tile.dataset.char = name;

    var sprite = document.createElement("img");
    sprite.className = "tile-sprite";
    sprite.src = lookup.sprite;
    sprite.alt = "";

    var plate = document.createElement("div");
    plate.className = "tile-plate";
    var nameSpan = document.createElement("span");
    nameSpan.className = "tile-name";
    nameSpan.textContent = name;
    var levelSpan = document.createElement("span");
    levelSpan.className = "tile-level";
    levelSpan.textContent = "Lv." + lookup.level;
    plate.appendChild(nameSpan);
    plate.appendChild(levelSpan);

    var job = document.createElement("div");
    job.className = "tile-job";
    job.textContent = lookup.job;

    var updated = document.createElement("div");
    updated.className = "tile-updated";
    updated.textContent = "updated just now";

    var actions = document.createElement("div");
    actions.className = "tile-actions";
    actions.appendChild(makeAction("[edit]"));
    actions.appendChild(makeRefreshAction(updated));
    actions.appendChild(makeDeleteAction(tile));

    tile.appendChild(sprite);
    tile.appendChild(plate);
    tile.appendChild(job);
    tile.appendChild(makeMiniInventory(lookup.items));
    tile.appendChild(updated);
    tile.appendChild(actions);

    wireTileNav(tile);
    charGrid.appendChild(tile);
  }

  // Wire up navigation + actions for the tiles already in the static markup.
  Array.prototype.forEach.call(charGrid.querySelectorAll(".char-tile"), function (tile) {
    wireTileNav(tile);

    var editLink = tile.querySelector(".edit-link");
    var refreshLink = tile.querySelector(".refresh-link");
    var deleteLink = tile.querySelector(".delete-link");
    var updatedEl = tile.querySelector(".tile-updated");

    editLink.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    refreshLink.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      updatedEl.textContent = "refreshing…";
      setTimeout(function () {
        updatedEl.textContent = "updated just now";
      }, 900);
    });

    deleteLink.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      tile.remove();
    });
  });

  addToggle.addEventListener("click", function (e) {
    e.preventDefault();
    if (addForm.hidden) {
      openForm();
    } else {
      closeForm();
    }
  });

  addCancel.addEventListener("click", function (e) {
    e.preventDefault();
    closeForm();
  });

  addSubmit.addEventListener("click", function (e) {
    e.preventDefault();
    var name = addName.value.trim();
    if (!name) return;
    addTile(name);
    closeForm();
  });

  addName.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      addSubmit.click();
    }
  });
})();
