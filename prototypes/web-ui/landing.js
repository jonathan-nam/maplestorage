(function () {
  "use strict";

  var tryItButton = document.getElementById("try-it-button");
  var exampleRows = document.getElementById("example-rows");

  // Real, manually-verified counts from the earliest vision-feasibility check
  // in this project (see PLAN.md) — not fabricated numbers. Icons sourced
  // from maplestorywiki.net (media.maplestorywiki.net/yetidb/Use_*.png).
  var SAMPLE_ITEMS = [
    { name: "Distorted Ambition", qty: 10, icon: "assets/icon-distorted-ambition.png" },
    { name: "Blissful Fantasy Shard", qty: 6, icon: "assets/icon-blissful-fantasy-shard.png" },
    { name: "Echo of Ancient Resolve", qty: 6, icon: "assets/icon-echo-ancient-resolve.png" },
    { name: "Ferocious Beast Entanglement Ring", qty: 9, icon: "assets/icon-ferocious-beast-ring.png" },
    { name: "Kalos's Residual Determination", qty: 21, icon: "assets/icon-kalos-token.png" }
  ];

  function buildRow(item) {
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
    nameCell.textContent = item.name;

    var qtyCell = document.createElement("td");
    qtyCell.className = "qty";
    qtyCell.textContent = item.qty;

    row.appendChild(iconCell);
    row.appendChild(nameCell);
    row.appendChild(qtyCell);
    return row;
  }

  tryItButton.addEventListener("click", function (e) {
    e.preventDefault();

    exampleRows.innerHTML = "";
    var detectingRow = document.createElement("tr");
    var detectingCell = document.createElement("td");
    detectingCell.colSpan = 3;
    detectingCell.className = "example-detecting";
    detectingCell.textContent = "Detecting…";
    detectingRow.appendChild(detectingCell);
    exampleRows.appendChild(detectingRow);

    tryItButton.textContent = "[reading screenshot…]";

    setTimeout(function () {
      exampleRows.innerHTML = "";
      SAMPLE_ITEMS.forEach(function (item) {
        exampleRows.appendChild(buildRow(item));
      });
      tryItButton.textContent = "[see it in action again]";
    }, 1100);
  });
})();
