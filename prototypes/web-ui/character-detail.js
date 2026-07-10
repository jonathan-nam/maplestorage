(function () {
  "use strict";

  // Fake per-character token list, standing in for a real CharacterTokenCount
  // query scoped to one character (see PLAN.md). Only the fixed 6 confirmed
  // Grandis tokens are possible rows here — no other item types exist in this
  // catalog, so there's no category grouping to render.
  var FAKE_CHARACTERS = {
    "Bubbling": {
      sprite: "assets/bubbling.png", level: 285, job: "Hoyoung",
      items: [
        { name: "Kalos's Residual Determination", icon: "assets/icon-kalos-token.png", qty: 7, redemption: "collect 10 → Eternal set" },
        { name: "Distorted Ambition", icon: null, qty: 4, redemption: "collect 10 → Eternal set" }
      ]
    },
    "Squishy": {
      sprite: "assets/squishy.png", level: 271, job: "Bow Master",
      items: [
        { name: "Distorted Ambition", icon: null, qty: 9, redemption: "collect 10 → Eternal set" }
      ]
    },
    "Nightshade": {
      sprite: "assets/nightshade.png", level: 299, job: "Hero",
      items: [
        { name: "Kalos's Residual Determination", icon: "assets/icon-kalos-token.png", qty: 10, redemption: "collect 10 → Eternal set" },
        { name: "Ferocious Beast Entanglement Ring", icon: null, qty: 3, redemption: "collect 10 → Eternal set" }
      ]
    }
  };

  function getParam(key) {
    var params = new URLSearchParams(window.location.search);
    return params.get(key);
  }

  var name = getParam("char") || "Bubbling";
  var data = FAKE_CHARACTERS[name] || FAKE_CHARACTERS["Bubbling"];

  document.title = "MapleStorage — " + name;

  var header = document.getElementById("detail-header");

  var sprite = document.createElement("img");
  sprite.className = "tile-sprite";
  sprite.src = data.sprite;
  sprite.alt = "";

  var info = document.createElement("div");
  var h1 = document.createElement("h1");
  h1.textContent = name + "  Lv." + data.level;
  var meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = data.job;
  info.appendChild(h1);
  info.appendChild(meta);

  header.appendChild(sprite);
  header.appendChild(info);

  var rows = document.getElementById("detail-item-rows");

  if (data.items.length === 0) {
    var emptyRow = document.createElement("tr");
    var emptyCell = document.createElement("td");
    emptyCell.colSpan = 3;
    emptyCell.className = "breakdown-cell";
    emptyCell.textContent = "No tokens read from this character yet — upload an inventory screenshot to populate it.";
    emptyRow.appendChild(emptyCell);
    rows.appendChild(emptyRow);
  }

  data.items.forEach(function (item) {
    var row = document.createElement("tr");

    var iconCell = document.createElement("td");
    if (item.icon) {
      var img = document.createElement("img");
      img.className = "icon";
      img.src = item.icon;
      img.alt = "";
      iconCell.appendChild(img);
    } else {
      var placeholder = document.createElement("div");
      placeholder.className = "icon icon-placeholder";
      iconCell.appendChild(placeholder);
    }

    var nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    nameCell.appendChild(document.createTextNode(item.name + " "));
    if (item.redemption) {
      var badge = document.createElement("span");
      badge.className = "redemption-note";
      badge.textContent = item.redemption;
      nameCell.appendChild(badge);
    }

    var qtyCell = document.createElement("td");
    qtyCell.className = "qty";
    qtyCell.textContent = item.qty;

    row.appendChild(iconCell);
    row.appendChild(nameCell);
    row.appendChild(qtyCell);
    rows.appendChild(row);
  });
})();
