// nav.js — per-role tab definitions for the blue sub-hero bar.
// `current` is the page key. In-page tabs (matching the current page) use a
// plain id so the sub-hero reveals the panel; tabs that live on another page
// get an `href` so they navigate. The caller passes `active` to highlight one.

// Student flow spans three pages (student / library / attachment) but shares
// one bar so it feels like tabbed navigation.
export function studentTabs(current) {
  const onStudent = current === "student";
  return [
    onStudent
      ? { id: "tab-dash",    label: "Dashboard",         icon: "dash" }
      : { id: "tab-dash",    label: "Dashboard",         icon: "dash",   href: "student.html#tab-dash" },
    onStudent
      ? { id: "tab-fin",     label: "My Finance",        icon: "fin"  }
      : { id: "tab-fin",     label: "My Finance",        icon: "fin",    href: "student.html#tab-fin" },
    onStudent
      ? { id: "tab-account", label: "Account",           icon: "acc"  }
      : { id: "tab-account", label: "Account",           icon: "acc",    href: "student.html#tab-account" },
    onStudent
      ? { id: "tab-lib",    label: "Library",           icon: "lib"    }
      : { id: "lib",        label: "Library",           icon: "lib",   href: "library.html" },
    onStudent
      ? { id: "tab-attach", label: "Attachment Letter", icon: "attach" }
      : { id: "attach",     label: "Attachment Letter", icon: "attach", href: "attachment.html" },
    onStudent
      ? { id: "tab-placement", label: "Attachment Placement", icon: "placement" }
      : { id: "placement",     label: "Attachment Placement", icon: "placement", href: "student.html#tab-placement" },
  ];
}

// Executive tabs. `flags` toggles position-gated tabs.
export function executiveTabs(flags = {}) {
  const tabs = [
    { id: "tab-pending",  label: "Pending",      icon: "inbox" },
    { id: "tab-all",      label: "All payments", icon: "fin"   },
    { id: "tab-finances", label: "Finances",     icon: "bank"  },
    { id: "tab-reports",  label: "Reports",      icon: "chart" },
    { id: "tab-profile",  label: "My Profile",   icon: "acc"   },
  ];
  if (flags.content)    tabs.push({ id: "tab-content",     label: "Public Content", icon: "file"   });
  if (flags.activities) tabs.push({ id: "tab-activities",  label: "Activities",     icon: "layers" });
  if (flags.library)    tabs.push({ id: "tab-library-mod", label: "Library",        icon: "lib"    });
  if (flags.placements) tabs.push({ id: "tab-placements",  label: "Placements",     icon: "attach" });
  return tabs;
}

export function adminTabs() {
  return [
    { id: "tab-students",   label: "Students",   icon: "users"  },
    { id: "tab-executives", label: "Executives", icon: "exec"   },
    { id: "tab-account",    label: "Account",    icon: "acc"    },
    { id: "tab-system",     label: "System",     icon: "system" },
  ];
}

export function secretaryTabs() {
  return [
    { id: "tab-session",      label: "Session Control",  icon: "toggle" },
    { id: "tab-pending",      label: "Pending Requests", icon: "inbox"  },
    { id: "tab-approved",     label: "Approved",         icon: "check"  },
    { id: "tab-template",     label: "Template",         icon: "file"   },
    { id: "tab-placeholders", label: "Placeholders",     icon: "tag"    },
    { id: "tab-account",      label: "Account",          icon: "acc"    },
  ];
}
