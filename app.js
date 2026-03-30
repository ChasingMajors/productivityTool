const API_BASE = "https://script.google.com/macros/s/AKfycbzFhs7W99H2Q5jNhEnAMKM01zLlW4uarrBxwW4GshhSeVDkBxr14rKPdkjPHsEOxV1h/exec";

const STORE = {
  USER_EMAIL: "ivy_user_email",
  USER_NAME: "ivy_user_name"
};

const state = {
  user: null,
  todayYmd: ymdLocal(new Date()),
  todayBundle: null,
  previousBundle: null,
  tomorrowBundle: null
};

const mainView = document.getElementById("mainView");
const signOutBtn = document.getElementById("signOutBtn");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

signOutBtn.addEventListener("click", () => {
  localStorage.removeItem(STORE.USER_EMAIL);
  localStorage.removeItem(STORE.USER_NAME);
  state.user = null;
  state.todayBundle = null;
  state.previousBundle = null;
  state.tomorrowBundle = null;
  renderLogin();
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
    await loadHome();
  } catch (err) {
    renderError(err.message || "Could not load the app.");
  }
}

function renderLogin() {
  signOutBtn.classList.add("hidden");

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Focused Planning</div>
      <h2>Build your six priorities</h2>
      <p class="muted big">This first version uses email-only sign-in. Real Google login comes next.</p>
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
      localStorage.setItem(STORE.USER_NAME, name);
      await loadHome();
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
  return data.user;
}

async function loadHome() {
  const email = state.user.email;
  const today = state.todayYmd;
  const tomorrow = addDays(today, 1);

  setLoading("Preparing your workspace...");

  const [todayBundle, previousBundle, tomorrowBundle] = await Promise.all([
    apiGet("getTodayPlan", { email, plan_date: today }),
    apiGet("getPreviousPlan", { email }),
    apiGet("getTodayPlan", { email, plan_date: tomorrow })
  ]);

  if (!todayBundle.ok) throw new Error(todayBundle.error || "Could not load today.");
  if (!previousBundle.ok) throw new Error(previousBundle.error || "Could not load prior plan.");
  if (!tomorrowBundle.ok) throw new Error(tomorrowBundle.error || "Could not load tomorrow.");

  state.todayBundle = todayBundle;
  state.previousBundle = previousBundle;
  state.tomorrowBundle = tomorrowBundle;

  if (todayBundle.has_plan) {
    renderTodayFocus(todayBundle);
    return;
  }

  if (tomorrowBundle.has_plan) {
    renderTomorrowAlreadyPlanned(tomorrowBundle);
    return;
  }

  renderPlanningGate();
}

function renderTodayFocus(bundle) {
  const tasks = bundle.tasks || [];
  const current = bundle.current_task;
  const completedCount = tasks.filter(t => toBool(t.completed)).length;

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Today’s Focus</div>
      <h2>${current ? `Priority ${escapeHtml(String(current.task_rank))}` : "All priorities complete"}</h2>
      <p class="big">${current ? escapeHtml(current.task_text || "") : "You completed all six priorities."}</p>
      <div class="kpi">${completedCount} of 6 complete</div>

      ${current ? `
        <div class="sp16"></div>
        <button id="completeCurrentBtn" class="btn success full" type="button">Mark Complete</button>
      ` : ""}
    </section>

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
  `;

  const btn = document.getElementById("completeCurrentBtn");
  if (btn && current) {
    btn.addEventListener("click", async () => {
      try {
        setLoading("Updating task...");
        const res = await apiPost("completeTask", { task_id: current.task_id });
        if (!res.ok) throw new Error(res.error || "Could not complete task.");
        await loadHome();
      } catch (err) {
        renderError(err.message || "Could not complete task.");
      }
    });
  }
}

function renderTomorrowAlreadyPlanned(bundle) {
  const tomorrow = bundle.plan_date;

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">Tomorrow is set</div>
      <h2>Your six priorities are already planned</h2>
      <p class="muted">Date: ${escapeHtml(tomorrow)}</p>
    </section>

    <section class="card">
      <h3>Tomorrow’s list</h3>
      ${(bundle.tasks || []).map(task => `
        <div class="task-item">
          <div class="rank">${escapeHtml(String(task.task_rank))}</div>
          <div class="task-copy">${escapeHtml(task.task_text || "")}</div>
        </div>
      `).join("")}
    </section>
  `;
}

function renderPlanningGate() {
  const previousTasks = (state.previousBundle && state.previousBundle.tasks) ? state.previousBundle.tasks : [];
  const hasPreviousPlan = !!(state.previousBundle && state.previousBundle.has_previous_plan && previousTasks.length);

  mainView.innerHTML = `
    <section class="card hero">
      <div class="eyebrow">End of day planning</div>
      <h2>Set up tomorrow’s six priorities</h2>
      <p class="muted">Start by deciding whether today’s work is fully complete.</p>
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
      <div class="eyebrow">Carry over unfinished work</div>
      <h2>Select any priorities to move forward</h2>
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

    try {
      setLoading("Saving tomorrow’s plan...");
      const res = await apiPost("saveNextDayPlan", {
        email: state.user.email,
        plan_date: tomorrow,
        source_plan_id: state.previousBundle?.plan?.plan_id || "",
        tasks: finalTasks
      });

      if (!res.ok) throw new Error(res.error || "Could not save plan.");

      await loadHome();
    } catch (err) {
      renderError(err.message || "Could not save tomorrow’s plan.");
    }
  });
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

  document.getElementById("retryBtn").addEventListener("click", boot);
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

