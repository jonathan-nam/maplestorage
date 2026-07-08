(function () {
  "use strict";

  // Fake per-character full inventory, standing in for a real
  // CharacterItemCount query scoped to one character (see PLAN.md). Category
  // values are the real in-game tabs, not an app-invented scheme — tokens
  // (redemptionTracked) live under ETC like any other item, badge-annotated.
  var FAKE_CHARACTERS = {
    "Bubbling": {
      sprite: "assets/bubbling.png", level: 285, job: "Hoyoung",
      items: [
        { category: "ETC", name: "Kalos's Residual Determination", icon: "assets/icon-kalos-token.png", qty: 7, redemption: "collect 10 → Eternal set" },
        { category: "ETC", name: "Distorted Ambition", icon: null, qty: 4, redemption: "collect 10 → Eternal set" },
        { category: "USE", name: "White Potion", icon: "assets/icon-white-potion.png", qty: 12 },
        { category: "USE", name: "Wealth Acquisition Potion", icon: "assets/icon-wealth-potion.png", qty: 2 },
        { category: "USE", name: "Sunday's Growth Box", icon: "assets/icon-growth-box.png", qty: 1 }
      ]
    },
    "Squishy": {
      sprite: "assets/squishy.png", level: 271, job: "Bow Master",
      items: [
        { category: "ETC", name: "Distorted Ambition", icon: null, qty: 9, redemption: "collect 10 → Eternal set" },
        { category: "USE", name: "White Potion", icon: "assets/icon-white-potion.png", qty: 45 },
        { category: "USE", name: "Sunday's Growth Box", icon: "assets/icon-growth-box.png", qty: 1 }
      ]
    },
    "Nightshade": {
      sprite: "assets/nightshade.png", level: 299, job: "Hero",
      items: [
        { category: "ETC", name: "Kalos's Residual Determination", icon: "assets/icon-kalos-token.png", qty: 10, redemption: "collect 10 → Eternal set" },
        { category: "ETC", name: "Ferocious Beast Entanglement Ring", icon: null, qty: 3, redemption: "collect 10 → Eternal set" },
        { category: "USE", name: "Wealth Acquisition Potion", icon: "assets/icon-wealth-potion.png", qty: 5 },
        { category: "USE", name: "Sunday's Growth Box", icon: "assets/icon-growth-box.png", qty: 3 }
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
  var seenCategories = {};

  data.items.forEach(function (item) {
    if (!seenCategories[item.category]) {
      seenCategories[item.category] = true;
      var headerRow = document.createElement("tr");
      headerRow.className = "category-header";
      var headerCell = document.createElement("td");
      headerCell.colSpan = 3;
      headerCell.textContent = item.category;
      headerRow.appendChild(headerCell);
      rows.appendChild(headerRow);
    }

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
