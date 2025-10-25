document.addEventListener("DOMContentLoaded", () => {
  // Handle nav pill selection so the UI mirrors the design interactions.
  const navItems = document.querySelectorAll(".main-nav .nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((btn) => btn.classList.remove("active"));
      item.classList.add("active");
    });
  });

  const toggleGroups = [
    document.querySelectorAll(".map-layer-toggle .pill-button"),
    document.querySelectorAll(".map-tabs .pill-button"),
  ];

  toggleGroups.forEach((group) => {
    if (!group.length) {
      return;
    }
    group.forEach((button) => {
      button.addEventListener("click", () => {
        group.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
    });
  });
});
