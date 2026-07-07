(function () {
  "use strict";

  var addToggle = document.getElementById("add-toggle");
  var addForm = document.getElementById("add-form");
  var addName = document.getElementById("add-name");
  var addSubmit = document.getElementById("add-submit");
  var addCancel = document.getElementById("add-cancel");
  var charRows = document.getElementById("char-rows");

  // Fake lookup results cycled deterministically, standing in for the real
  // Nexon no-auth ranking lookup (see PLAN.md) which isn't callable from a
  // static file:// prototype.
  var FAKE_LOOKUPS = [
    { sprite: "assets/bubbling.png", level: 285, job: "Hoyoung" },
    { sprite: "assets/squishy.png", level: 271, job: "Bow Master" },
    { sprite: "assets/nightshade.png", level: 299, job: "Hero" }
  ];
  var lookupIndex = 0;

  function openForm() {
    addForm.hidden = false;
    addName.focus();
  }

  function closeForm() {
    addForm.hidden = true;
    addName.value = "";
  }

  function addRow(name) {
    var lookup = FAKE_LOOKUPS[lookupIndex % FAKE_LOOKUPS.length];
    lookupIndex++;

    var row = document.createElement("tr");

    var spriteCell = document.createElement("td");
    var sprite = document.createElement("img");
    sprite.className = "sprite";
    sprite.src = lookup.sprite;
    sprite.alt = "";
    spriteCell.appendChild(sprite);

    var nameCell = document.createElement("td");
    nameCell.textContent = name;

    var levelCell = document.createElement("td");
    levelCell.textContent = lookup.level;

    var jobCell = document.createElement("td");
    jobCell.textContent = lookup.job;

    var updatedCell = document.createElement("td");
    updatedCell.textContent = "just now";

    var actionsCell = document.createElement("td");
    actionsCell.className = "row-actions";
    actionsCell.appendChild(makeAction("[edit]"));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(makeRefreshAction(updatedCell));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(makeDeleteAction(row));

    row.appendChild(spriteCell);
    row.appendChild(nameCell);
    row.appendChild(levelCell);
    row.appendChild(jobCell);
    row.appendChild(updatedCell);
    row.appendChild(actionsCell);

    charRows.appendChild(row);
  }

  function makeAction(label) {
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = label;
    a.addEventListener("click", function (e) {
      e.preventDefault();
    });
    return a;
  }

  function makeRefreshAction(updatedCell) {
    var a = document.createElement("a");
    a.href = "#";
    a.className = "refresh-link";
    a.textContent = "[refresh]";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var previous = updatedCell.textContent;
      updatedCell.textContent = "refreshing…";
      setTimeout(function () {
        updatedCell.textContent = "just now";
      }, 900);
    });
    return a;
  }

  function makeDeleteAction(row) {
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = "[delete]";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      row.remove();
    });
    return a;
  }

  // Wire up refresh/delete for the rows already in the static markup.
  Array.prototype.forEach.call(charRows.querySelectorAll("tr"), function (row) {
    var updatedCell = row.children[4];
    var actionsCell = row.children[5];
    actionsCell.innerHTML = "";
    actionsCell.appendChild(makeAction("[edit]"));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(makeRefreshAction(updatedCell));
    actionsCell.appendChild(document.createTextNode(" "));
    actionsCell.appendChild(makeDeleteAction(row));
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
    addRow(name);
    closeForm();
  });

  addName.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      addSubmit.click();
    }
  });
})();
