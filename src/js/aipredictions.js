document.addEventListener("DOMContentLoaded", () => {
  // Keep nav active state while navigating between sections.
  const navItems = document.querySelectorAll(".main-nav .nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((link) => link.classList.remove("active"));
      item.classList.add("active");
    });
  });

  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");

  const setActiveTab = (tabId) => {
    tabButtons.forEach((button) => {
      const isMatch = button.dataset.tab === tabId;
      button.classList.toggle("is-active", isMatch);
      button.setAttribute("aria-selected", String(isMatch));
    });

    tabPanels.forEach((panel) => {
      const isMatch = panel.dataset.tabPanel === tabId;
      panel.classList.toggle("is-active", isMatch);
      if (isMatch) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "hidden");
      }
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;
      if (!tabId) {
        return;
      }
      setActiveTab(tabId);
    });
  });

  const initial = document.querySelector(".tab-button.is-active");
  if (initial && initial.dataset.tab) {
    setActiveTab(initial.dataset.tab);
  }
});
