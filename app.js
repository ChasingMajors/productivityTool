const API_BASE = "https://script.google.com/macros/s/AKfycbyF2C1s83U4Hh68iCjRj67COnDAHlDS85xGTJ80-jpl7K0BxVCUhCXB2JfQchwik51kBA/exec";

const STORE = {
  USER_EMAIL: "dfp_user_email",
  USER_NAME: "dfp_user_name",
  ACTIVE_TAB: "dfp_active_tab"
};

const state = {
  user: null,
  todayYmd: ymdLocal(new Date()),
  todayBundle: null,
  previousBundle: null,
  tomorrowBundle: null,
  historyBundles: [],
  activeTab: localStorage.getItem(STORE.ACTIVE_TAB) || "today"
};

const mainView = document.getElementById("mainView");
const signOutBtn = document.getElementById("signOutBtn");
const navButtons = [...document.querySelectorAll(".nav-btn")];

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

signOutBtn.addEventListener("click", () => {
  localStorage.removeItem(STORE.USER_EMAIL);
  localStorage.removeItem(STORE.USER_NAME);
  localStorage.removeItem(STORE.ACTIVE_TAB);

  state.user = null;
  state.todayBundle = null;
  state.previousBundle = null;
  state.tomorrowBundle = null;
  state.historyBundles = [];
  state.activeTab = "today";

  disableNavForLoggedOut();
  updateNav();
  renderLogin();
});

navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    if (!tab || !state.user) return;
    setActiveTab(tab);
    renderActiveTab();
  });
});

boot();

async function boot() {
  const email = localStorage.getItem(STORE.USER_EMAIL);
  const name = localStorage.getItem(STORE.USER_NAME);

  if (!email) {
    renderLogin();
    return;
  }

  try {
    setLoading("Loading your planner...");
    await ensureUser(email, name || "");
    await refreshAllData();
    if (!state.activeTab) setActiveTab("today");
    renderActiveTab();
  } catch (err) {
    renderError(err.message || "Could not load the app.");
  }
}

function renderLogin() {
  signOutBtn.classList.add("hidden");
  disableNavForLoggedOut();

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Deep Focus Planner</div>
      <h2>Plan tomorrow. Execute today.</h2>
      <p class="muted big">Sign in with your email for this first version.</p>
    </section>

    <section class="card">
      <div class="label">Display name</div>
      <input id="nameInput" class="input" type="text" placeholder="John" />

      <div class="sp12"></div>

      <div class="label">Email</div>
      <input id="emailInput" class="input" type="email" placeholder="you@example.com" />

      <div class="sp16"></div>

      <button id="continueBtn" class="btn primary full" type="button">Continue</button>
    </section>
  `;

  document.getElementById("continueBtn").addEventListener("click", async () => {
    const email = document.getElementById("emailInput").value.trim().toLowerCase();
    const name = document.getElementById("nameInput").value.trim();

    if (!email) {
      alert("Please enter your email.");
      return;
    }

    try {
      setLoading("Signing you in...");
      await ensureUser(email, name);
      localStorage.setItem(STORE.USER_EMAIL, email);
      localStorage.setItem(STORE.USER_NAME, name || "");
      setActiveTab("today");
      await refreshAllData();
      renderActiveTab();
    } catch (err) {
      renderError(err.message || "Could not sign in.");
    }
  });
}

async function ensureUser(email, displayName) {
  const url = new URL(API_BASE);
  url.searchParams.set("action", "getOrCreateUser");
  url.searchParams.set("email", email);
  url.searchParams.set("display_name", displayName || "");
  url.searchParams.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Denver");

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!data.ok) throw new Error(data.error || "User lookup failed.");

  state.user = data.user;
  signOutBtn.classList.remove("hidden");
  enableNavForLoggedIn();
  return data.user;
}

async function refreshAllData() {
  if (!state.user?.email) return;

  const email = state.user.email;
  const today = state.todayYmd;
  const tomorrow = addDays(today, 1);

  const [todayBundle, previousBundle, tomorrowBundle] = await Promise.all([
    apiGet("getTodayPlan", { email, plan_date: today }),
    apiGet("getPreviousPlan", { email }),
    apiGet("getTodayPlan", { email, plan_date: tomorrow })
  ]);

  if (!todayBundle.ok) throw new Error(todayBundle.error || "Could not load today.");
  if (!previousBundle.ok) throw new Error(previousBundle.error || "Could not load previous plan.");
  if (!tomorrowBundle.ok) throw new Error(tomorrowBundle.error || "Could not load tomorrow.");

  state.todayBundle = todayBundle;
  state.previousBundle = previousBundle;
  state.tomorrowBundle = tomorrowBundle;

  if (todayBundle.user) {
    state.user = todayBundle.user;
  }

  await loadHistory();
}

async function loadHistory() {
  const email = state.user?.email;
  if (!email) {
    state.historyBundles = [];
    return;
  }

  const dates = [];
  for (let i = 0; i < 14; i++) {
    dates.push(addDays(state.todayYmd, -i));
  }

  const bundles = await Promise.all(
    dates.map(d => apiGet("getPlanByDate", { email, plan_date: d }))
  );

  state.historyBundles = bundles
    .filter(bundle => bundle.ok && bundle.has_plan)
    .sort((a, b) => String(b.plan_date).localeCompare(String(a.plan_date)));
}

function setActiveTab(tab) {
  state.activeTab = tab;
  localStorage.setItem(STORE.ACTIVE_TAB, tab);
  updateNav();
}

function updateNav() {
  navButtons.forEach(btn => {
    const isActive = btn.dataset.tab === state.activeTab;
    btn.classList.toggle("nav-btn-active", isActive);
  });
}

function enableNavForLoggedIn() {
  navButtons.forEach(btn => {
    btn.disabled = false;
  });
  updateNav();
}

function disableNavForLoggedOut() {
  navButtons.forEach(btn => {
    btn.disabled = true;
    btn.classList.remove("nav-btn-active");
  });
}

function renderActiveTab() {
  updateNav();

  switch (state.activeTab) {
    case "today":
      renderTodayTab();
      break;
    case "plan":
      renderPlanTab();
      break;
    case "history":
      renderHistoryTab();
      break;
    case "settings":
      renderSettingsTab();
      break;
    default:
      renderTodayTab();
      break;
  }
}

/* =========================
   TODAY TAB
========================= */

function renderTodayTab() {
  const todayBundle = state.todayBundle;
  const tomorrowBundle = state.tomorrowBundle;
  const todayHasPlan = !!todayBundle?.has_plan;
  const tomorrowHasPlan = !!tomorrowBundle?.has_plan;

  if (!todayHasPlan) {
    mainView.innerHTML = `
      <section class="card hero">
        <div class="eyebrow">Today</div>
        <h2>No active plan for today</h2>
        <p class="muted">You do not currently have a saved 6-priority list for ${escapeHtml(state.todayYmd)}.</p>
      </section>

      <section class="card">
        <h3>Status</h3>
        <div class="sp12"></div>
        <div class="badge">${tomorrowHasPlan ? "Tomorrow is already planned" : "Tomorrow is not planned yet"}</div>
        <div class="sp16"></div>
        <div class="row stack-mobile">
          <button id="goPlanBtn" class="btn primary" type="button">${tomorrowHasPlan ? "Open Tomorrow’s Plan" : "Plan Tomorrow"}</button>
          ${tomorrowHasPlan ? `<button id="editTomorrowBtn" class="btn secondary" type="button">Edit Tomorrow</button>` : ""}
        </div>
      </section>

      ${tomorrowHasPlan ? `
        <section class="card">
          <h3>Tomorrow preview</h3>
          ${(tomorrowBundle.tasks || []).map(task => `
            <div class="task-item">
              <div class="rank">${escapeHtml(String(task.task_rank))}</div>
              <div class="task-copy">${escapeHtml(task.task_text || "")}</div>
            </div>
          `).join("")}
        </section>
      ` : ""}
    `;

    document.getElementById("goPlanBtn").addEventListener("click", () => {
      setActiveTab("plan");
      renderActiveTab();
    });

    const editTomorrowBtn = document.getElementById("editTomorrowBtn");
    if (editTomorrowBtn) {
      editTomorrowBtn.addEventListener("click", () => {
        setActiveTab("plan");
        renderActiveTab();
      });
    }

    return;
  }

  const tasks = todayBundle.tasks || [];
  const current = todayBundle.current_task;
  const completedCount = tasks.filter(task => toBool(task.completed)).length;
  const allComplete = completedCount === 6;

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Today’s Focus</div>
      <h2>${allComplete ? "All priorities complete" : `Priority ${escapeHtml(String(current?.task_rank || ""))}`}</h2>
      <p class="big">${allComplete ? "You completed all six priorities for today." : escapeHtml(current?.task_text || "")}</p>
      <div class="kpi">${completedCount} of 6 complete</div>

      ${!allComplete && current ? `
        <div class="sp16"></div>
        <button id="completeCurrentBtn" class="btn success full" type="button">Mark Complete</button>
      ` : ""}
    </section>

    ${allComplete ? `
      <section class="card">
        <h3>Nice work</h3>
        <p class="muted">${tomorrowHasPlan ? "Tomorrow is already planned, so you’re set up for the next day." : "Now is a great time to build tomorrow’s six priorities."}</p>
        <div class="sp16"></div>
        <div class="row stack-mobile">
          <button id="todayPlanTomorrowBtn" class="btn primary" type="button">${tomorrowHasPlan ? "View Tomorrow’s Plan" : "Plan Tomorrow"}</button>
          ${tomorrowHasPlan ? `<button id="todayEditTomorrowBtn" class="btn secondary" type="button">Edit Tomorrow</button>` : ""}
        </div>
      </section>
    ` : ""}

    <section class="card">
      <h3>Full list</h3>
      ${tasks.map(task => `
        <div class="task-item">
          <div class="rank">${escapeHtml(String(task.task_rank))}</div>
          <div class="task-copy">
            <div>${escapeHtml(task.task_text || "")}</div>
            <div class="progress">${toBool(task.completed) ? "Completed" : "Pending"}</div>
          </div>
        </div>
      `).join("")}
    </section>

    ${tomorrowHasPlan ? `
      <section class="card">
        <h3>Tomorrow preview</h3>
        ${(tomorrowBundle.tasks || []).map(task => `
          <div class="task-item">
            <div class="rank">${escapeHtml(String(task.task_rank))}</div>
            <div class="task-copy">${escapeHtml(task.task_text || "")}</div>
          </div>
        `).join("")}
      </section>
    ` : ""}
  `;

  const btn = document.getElementById("completeCurrentBtn");
  if (btn && current && !allComplete) {
    btn.addEventListener("click", async () => {
      try {
        setLoading("Updating task...");
        const res = await apiPost("completeTask", { task_id: current.task_id });
        if (!res.ok) throw new Error(res.error || "Could not complete task.");
        await refreshAllData();
        renderTodayTab();
      } catch (err) {
        renderError(err.message || "Could not complete task.");
      }
    });
  }

  const todayPlanTomorrowBtn = document.getElementById("todayPlanTomorrowBtn");
  if (todayPlanTomorrowBtn) {
    todayPlanTomorrowBtn.addEventListener("click", () => {
      setActiveTab("plan");
      renderActiveTab();
    });
  }

  const todayEditTomorrowBtn = document.getElementById("todayEditTomorrowBtn");
  if (todayEditTomorrowBtn) {
    todayEditTomorrowBtn.addEventListener("click", () => {
      setActiveTab("plan");
      renderActiveTab();
    });
  }
}

/* =========================
   PLAN TAB
========================= */

function renderPlanTab() {
  const tomorrowBundle = state.tomorrowBundle;

  if (tomorrowBundle?.has_plan) {
    renderTomorrowPlanView();
    return;
  }

  renderPlanningGate(false);
}

function renderTomorrowPlanView() {
  const tomorrowBundle = state.tomorrowBundle;

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Plan</div>
      <h2>Tomorrow is already planned</h2>
      <p class="muted">Date: ${escapeHtml(tomorrowBundle.plan_date)}</p>
    </section>

    <section class="card">
      <h3>Tomorrow’s priorities</h3>
      ${(tomorrowBundle.tasks || []).map(task => `
        <div class="task-item">
          <div class="rank">${escapeHtml(String(task.task_rank))}</div>
          <div class="task-copy">${escapeHtml(task.task_text || "")}</div>
        </div>
      `).join("")}

      <div class="sp16"></div>
      <div class="row stack-mobile">
        <button id="editPlanBtn" class="btn primary" type="button">Edit Plan</button>
        <button id="replacePlanBtn" class="btn secondary" type="button">Replace Plan</button>
      </div>
    </section>
  `;

  document.getElementById("editPlanBtn").addEventListener("click", () => {
    renderEditTomorrowPlanForm();
  });

  document.getElementById("replacePlanBtn").addEventListener("click", () => {
    renderPlanningGate(true);
  });
}

function renderPlanningGate(isReplacing) {
  const previousTasks = (state.previousBundle && state.previousBundle.tasks) ? state.previousBundle.tasks : [];
  const todayTasks = (state.todayBundle && state.todayBundle.tasks) ? state.todayBundle.tasks : [];
  const hasPreviousPlan = !!(state.previousBundle && state.previousBundle.has_previous_plan && previousTasks.length);
  const hasTodayPlan = !!(state.todayBundle && state.todayBundle.has_plan && todayTasks.length);

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Plan</div>
      <h2>${isReplacing ? "Replace tomorrow’s six priorities" : "Set up tomorrow’s six priorities"}</h2>
      <p class="muted">Choose the fastest way to build tomorrow’s list.</p>
    </section>

    <section class="card">
      <h3>Quick start</h3>
      <div class="sp12"></div>
      <div class="row stack-mobile">
        ${hasTodayPlan ? `<button id="startFromTodayBtn" class="btn primary" type="button">Start From Today</button>` : ""}
        <button id="startFreshBtn" class="btn secondary" type="button">Start Fresh</button>
      </div>
    </section>

    <section class="card">
      <h3>Did you complete today’s tasks?</h3>
      <div class="sp12"></div>
      <div class="row stack-mobile">
        <button id="allDoneBtn" class="btn primary" type="button">Yes</button>
        <button id="notDoneBtn" class="btn secondary" type="button">No</button>
      </div>
    </section>

    ${hasPreviousPlan ? `
      <section class="card">
        <div class="badge">Previous plan found</div>
        <div class="sp12"></div>
        ${previousTasks.map(task => `
          <div class="task-item">
            <div class="rank">${escapeHtml(String(task.task_rank))}</div>
            <div class="task-copy">
              <div>${escapeHtml(task.task_text || "")}</div>
              <div class="progress">Completed: ${toBool(task.completed) ? "Yes" : "No"}</div>
            </div>
          </div>
        `).join("")}
      </section>
    ` : ""}
  `;

  const startFromTodayBtn = document.getElementById("startFromTodayBtn");
  if (startFromTodayBtn) {
    startFromTodayBtn.addEventListener("click", () => {
      const prefilled = todayTasks.slice(0, 6).map(task => ({
        task_text: task.task_text || "",
        carried_over: false,
        visibility: task.visibility || "private",
        shared_with: task.shared_with || "",
        notes: task.notes || ""
      }));
      renderEditPrefilledPlanForm(prefilled, addDays(state.todayYmd, 1));
    });
  }

  document.getElementById("startFreshBtn").addEventListener("click", () => {
    renderPlanForm([]);
  });

  document.getElementById("allDoneBtn").addEventListener("click", () => {
    renderPlanForm([]);
  });

  document.getElementById("notDoneBtn").addEventListener("click", () => {
    if (!hasPreviousPlan) {
      renderPlanForm([]);
      return;
    }
    renderCarryoverSelection(previousTasks);
  });
}

function renderCarryoverSelection(tasks) {
  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Carry over</div>
      <h2>Select unfinished work to move forward</h2>
      <p class="muted">Choose any number of tasks. You will fill the remaining slots after this.</p>
    </section>

    <section class="card">
      ${tasks.map(task => `
        <label class="checkbox-row">
          <input class="carryCheck" type="checkbox" value="${escapeAttr(task.task_text || "")}" />
          <div>
            <div><strong>#${escapeHtml(String(task.task_rank))}</strong> ${escapeHtml(task.task_text || "")}</div>
            <div class="progress">Completed: ${toBool(task.completed) ? "Yes" : "No"}</div>
          </div>
        </label>
      `).join("")}

      <div class="sp16"></div>
      <button id="carryContinueBtn" class="btn primary full" type="button">Continue</button>
    </section>
  `;

  document.getElementById("carryContinueBtn").addEventListener("click", () => {
    const selected = [...document.querySelectorAll(".carryCheck:checked")].map(el => ({
      task_text: el.value,
      carried_over: true,
      visibility: "private",
      shared_with: "",
      notes: ""
    }));

    if (selected.length > 6) {
      alert("You can only carry over up to 6 tasks.");
      return;
    }

    renderPlanForm(selected);
  });
}

function renderPlanForm(prefilledTasks) {
  const tomorrow = addDays(state.todayYmd, 1);
  const remaining = 6 - prefilledTasks.length;

  let carrySection = "";
  if (prefilledTasks.length) {
    carrySection = `
      <section class="card">
        <h3>Carried over</h3>
        ${prefilledTasks.map((task, idx) => `
          <div class="task-item">
            <div class="rank">${idx + 1}</div>
            <div class="task-copy">${escapeHtml(task.task_text || "")}</div>
          </div>
        `).join("")}
      </section>
    `;
  }

  let inputSection = "";
  for (let i = 0; i < remaining; i++) {
    const rank = prefilledTasks.length + i + 1;
    inputSection += `
      <div class="sp12"></div>
      <div class="label">Priority ${rank}</div>
      <input class="input newTaskInput" data-rank="${rank}" type="text" placeholder="Enter priority ${rank}" />
    `;
  }

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Tomorrow’s plan</div>
      <h2>Build your six priorities</h2>
      <p class="muted">Date: ${escapeHtml(tomorrow)}</p>
    </section>

    ${carrySection}

    <section class="card">
      <h3>Add remaining priorities</h3>
      <p class="muted">You must end with exactly six ranked tasks.</p>
      ${inputSection}
      <div class="sp16"></div>
      <button id="savePlanBtn" class="btn success full" type="button">Save Tomorrow’s Plan</button>
    </section>
  `;

  document.getElementById("savePlanBtn").addEventListener("click", async () => {
    const newValues = [...document.querySelectorAll(".newTaskInput")]
      .map(el => el.value.trim())
      .filter(Boolean);

    const finalTasks = [
      ...prefilledTasks,
      ...newValues.map(text => ({
        task_text: text,
        carried_over: false,
        visibility: "private",
        shared_with: "",
        notes: ""
      }))
    ];

    if (finalTasks.length !== 6) {
      alert("You need exactly 6 tasks.");
      return;
    }

    await savePlanAndShowPlan(finalTasks, tomorrow);
  });
}

function renderEditPrefilledPlanForm(prefilledTasks, planDate) {
  const padded = [...prefilledTasks];
  while (padded.length < 6) {
    padded.push({
      task_text: "",
      carried_over: false,
      visibility: "private",
      shared_with: "",
      notes: ""
    });
  }

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Plan</div>
      <h2>Build tomorrow from a base list</h2>
      <p class="muted">Date: ${escapeHtml(planDate)}</p>
    </section>

    <section class="card">
      ${padded.map((task, idx) => `
        <div class="sp12"></div>
        <div class="label">Priority ${idx + 1}</div>
        <input class="input prefilledTaskInput" data-rank="${idx + 1}" type="text" value="${escapeAttr(task.task_text || "")}" />
      `).join("")}

      <div class="sp16"></div>
      <div class="row stack-mobile">
        <button id="savePrefilledPlanBtn" class="btn success" type="button">Save Tomorrow’s Plan</button>
        <button id="cancelPrefilledBtn" class="btn secondary" type="button">Cancel</button>
      </div>
    </section>
  `;

  document.getElementById("savePrefilledPlanBtn").addEventListener("click", async () => {
    const values = [...document.querySelectorAll(".prefilledTaskInput")].map(el => el.value.trim());

    if (values.some(v => !v) || values.length !== 6) {
      alert("All 6 priorities must be filled out.");
      return;
    }

    const finalTasks = values.map((text, idx) => ({
      task_text: text,
      carried_over: !!prefilledTasks[idx]?.carried_over,
      visibility: prefilledTasks[idx]?.visibility || "private",
      shared_with: prefilledTasks[idx]?.shared_with || "",
      notes: prefilledTasks[idx]?.notes || ""
    }));

    await savePlanAndShowPlan(finalTasks, planDate);
  });

  document.getElementById("cancelPrefilledBtn").addEventListener("click", () => {
    renderPlanTab();
  });
}

function renderEditTomorrowPlanForm() {
  const tomorrowBundle = state.tomorrowBundle;
  const tasks = tomorrowBundle?.tasks || [];

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Edit Plan</div>
      <h2>Edit tomorrow’s priorities</h2>
      <p class="muted">Date: ${escapeHtml(tomorrowBundle.plan_date)}</p>
    </section>

    <section class="card">
      ${tasks.map((task, idx) => `
        <div class="sp12"></div>
        <div class="label">Priority ${idx + 1}</div>
        <input class="input editTaskInput" data-rank="${idx + 1}" type="text" value="${escapeAttr(task.task_text || "")}" />
      `).join("")}

      <div class="sp16"></div>
      <div class="row stack-mobile">
        <button id="saveEditedPlanBtn" class="btn success" type="button">Save Changes</button>
        <button id="cancelEditPlanBtn" class="btn secondary" type="button">Cancel</button>
      </div>
    </section>
  `;

  document.getElementById("saveEditedPlanBtn").addEventListener("click", async () => {
    const editedValues = [...document.querySelectorAll(".editTaskInput")]
      .map(el => el.value.trim());

    if (editedValues.some(v => !v) || editedValues.length !== 6) {
      alert("All 6 priorities must be filled out.");
      return;
    }

    const finalTasks = editedValues.map((text, idx) => ({
      task_text: text,
      carried_over: toBool(tasks[idx]?.carried_over),
      visibility: tasks[idx]?.visibility || "private",
      shared_with: tasks[idx]?.shared_with || "",
      notes: tasks[idx]?.notes || ""
    }));

    await savePlanAndShowPlan(finalTasks, tomorrowBundle.plan_date);
  });

  document.getElementById("cancelEditPlanBtn").addEventListener("click", () => {
    renderTomorrowPlanView();
  });
}

async function savePlanAndShowPlan(finalTasks, planDate) {
  try {
    setLoading("Saving plan...");
    const res = await apiPost("saveNextDayPlan", {
      email: state.user.email,
      plan_date: planDate,
      source_plan_id: state.previousBundle?.plan?.plan_id || "",
      tasks: finalTasks
    });

    if (!res.ok) throw new Error(res.error || "Could not save plan.");

    await refreshAllData();
    setActiveTab("plan");
    renderActiveTab();
  } catch (err) {
    renderError(err.message || "Could not save plan.");
  }
}

/* =========================
   HISTORY TAB
========================= */

function renderHistoryTab() {
  const bundles = state.historyBundles || [];

  if (!bundles.length) {
    mainView.innerHTML = `
      <section class="card hero">
        <div class="eyebrow">History</div>
        <h2>No saved plans yet</h2>
        <p class="muted">Once you start planning, your recent daily plans will appear here.</p>
      </section>
    `;
    return;
  }

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">History</div>
      <h2>Recent plans</h2>
      <p class="muted">Review your recent deep focus lists and completion status.</p>
    </section>

    <section class="card">
      ${bundles.map((bundle, idx) => {
        const completedCount = (bundle.tasks || []).filter(task => toBool(task.completed)).length;
        return `
          <div class="task-item" style="cursor:pointer;" data-history-index="${idx}">
            <div class="rank">${completedCount}</div>
            <div class="task-copy">
              <div>${escapeHtml(bundle.plan_date)}</div>
              <div class="progress">${completedCount} of ${(bundle.tasks || []).length} complete</div>
            </div>
          </div>
        `;
      }).join("")}
    </section>
  `;

  document.querySelectorAll("[data-history-index]").forEach(el => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.historyIndex);
      renderHistoryDetail(state.historyBundles[idx]);
    });
  });
}

function renderHistoryDetail(bundle) {
  const completedCount = (bundle.tasks || []).filter(task => toBool(task.completed)).length;

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">History Detail</div>
      <h2>${escapeHtml(bundle.plan_date)}</h2>
      <p class="muted">${completedCount} of ${(bundle.tasks || []).length} complete</p>
    </section>

    <section class="card">
      <h3>Saved priorities</h3>
      ${(bundle.tasks || []).map(task => `
        <div class="task-item">
          <div class="rank">${escapeHtml(String(task.task_rank))}</div>
          <div class="task-copy">
            <div>${escapeHtml(task.task_text || "")}</div>
            <div class="progress">${toBool(task.completed) ? "Completed" : "Pending"}</div>
          </div>
        </div>
      `).join("")}

      <div class="sp16"></div>
      <button id="backHistoryBtn" class="btn secondary full" type="button">Back to History</button>
    </section>
  `;

  document.getElementById("backHistoryBtn").addEventListener("click", () => {
    renderHistoryTab();
  });
}

/* =========================
   SETTINGS TAB
========================= */

function renderSettingsTab() {
  const user = state.user || {};
  const morningTime = user.morning_start_time || "08:00";
  const eveningTime = user.planning_reminder_time || "17:30";
  const repeatInterval = user.notification_interval || "60";
  const displayName = user.display_name || "";

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Settings</div>
      <h2>Planner preferences</h2>
      <p class="muted">These settings prepare the app for reminder support later.</p>
    </section>

    <section class="card">
      <div class="label">Display name</div>
      <input id="settingsName" class="input" type="text" value="${escapeAttr(displayName)}" />

      <div class="sp12"></div>

      <div class="label">Morning reminder time</div>
      <input id="settingsMorning" class="input" type="time" value="${escapeAttr(morningTime)}" />

      <div class="sp12"></div>

      <div class="label">Evening planning reminder time</div>
      <input id="settingsEvening" class="input" type="time" value="${escapeAttr(eveningTime)}" />

      <div class="sp12"></div>

      <div class="label">Repeat reminder interval</div>
      <select id="settingsInterval" class="select">
        ${["15","30","60","90","240"].map(v => `
          <option value="${v}" ${String(repeatInterval) === v ? "selected" : ""}>
            ${intervalLabel(v)}
          </option>
        `).join("")}
      </select>

      <div class="sp16"></div>

      <button id="saveSettingsBtn" class="btn primary full" type="button">Save Settings</button>
    </section>
  `;

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    const newName = document.getElementById("settingsName").value.trim();
    const morning = document.getElementById("settingsMorning").value || "08:00";
    const evening = document.getElementById("settingsEvening").value || "17:30";
    const interval = document.getElementById("settingsInterval").value || "60";
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Denver";

    try {
      setLoading("Saving settings...");

      const profileRes = await apiPost("updateUserProfile", {
        email: state.user.email,
        display_name: newName,
        timezone: timezone
      });

      if (!profileRes.ok) throw new Error(profileRes.error || "Could not save profile.");

      const settingsRes = await apiPost("saveNotificationSettings", {
        email: state.user.email,
        morning_enabled: true,
        morning_time: morning,
        repeat_enabled: true,
        repeat_interval: interval,
        evening_enabled: true,
        evening_time: evening,
        quiet_hours_start: "",
        quiet_hours_end: ""
      });

      if (!settingsRes.ok) throw new Error(settingsRes.error || "Could not save settings.");

      state.user = settingsRes.user || profileRes.user || {
        ...state.user,
        display_name: newName,
        timezone,
        morning_start_time: morning,
        planning_reminder_time: evening,
        notification_interval: interval
      };

      localStorage.setItem(STORE.USER_NAME, newName);

      renderSettingsSaved();
    } catch (err) {
      renderError(err.message || "Could not save settings.");
    }
  });
}

function renderSettingsSaved() {
  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Settings</div>
      <h2>Saved</h2>
      <p class="muted">Your settings were updated successfully.</p>
      <div class="sp16"></div>
      <button id="backSettingsBtn" class="btn primary full" type="button">Back to Settings</button>
    </section>
  `;

  document.getElementById("backSettingsBtn").addEventListener("click", () => {
    renderSettingsTab();
  });
}

/* =========================
   UTIL
========================= */

function intervalLabel(v) {
  switch (String(v)) {
    case "15": return "Every 15 minutes";
    case "30": return "Every 30 minutes";
    case "60": return "Every 60 minutes";
    case "90": return "Every 90 minutes";
    case "240": return "Every 4 hours";
    default: return `${v} minutes`;
  }
}

function setLoading(message) {
  mainView.innerHTML = `
    <section class="card hero center">
      <div class="eyebrow">Loading</div>
      <h2>${escapeHtml(message)}</h2>
      <p class="muted">Please wait...</p>
    </section>
  `;
}

function renderError(message) {
  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Something went wrong</div>
      <h2>App error</h2>
      <p class="muted">${escapeHtml(message)}</p>
      <div class="sp16"></div>
      <button id="retryBtn" class="btn primary full" type="button">Retry</button>
    </section>
  `;

  document.getElementById("retryBtn").addEventListener("click", async () => {
    try {
      setLoading("Reloading...");
      await refreshAllData();
      renderActiveTab();
    } catch (err) {
      renderError(err.message || "Could not reload.");
    }
  });
}

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const res = await fetch(url.toString());
  return await res.json();
}

async function apiPost(action, payload = {}) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({ action, payload })
  });

  return await res.json();
}

function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(ymd, days) {
  const dt = new Date(`${ymd}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  return ymdLocal(dt);
}

function toBool(value) {
  return String(value).toLowerCase() === "true";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
