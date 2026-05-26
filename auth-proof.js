import { getSupabaseClient } from "./lib/supabaseClient.js";

const form = document.querySelector("[data-auth-form]");
const emailInput = document.querySelector("[data-email]");
const passwordInput = document.querySelector("[data-password]");
const loginButton = document.querySelector("[data-login-button]");
const resetButton = document.querySelector("[data-reset-button]");
const logoutButton = document.querySelector("[data-logout-button]");
const statusEl = document.querySelector("[data-status]");
const noticeEl = document.querySelector("[data-notice]");
const errorEl = document.querySelector("[data-error]");
const userEmailEl = document.querySelector("[data-user-email]");
const communitiesEl = document.querySelector("[data-communities]");

let supabase;
let currentUser = null;

init();

async function init() {
  setStatus("Loading access...");
  setBusy(true);

  try {
    supabase = await getSupabaseClient();

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    currentUser = data.session?.user || null;
    renderSession();

    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      renderSession();
    });
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  clearNotice();
  setStatus("Signing in...");
  setBusy(true);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });

    if (error) throw error;

    currentUser = data.user || null;
    await renderSession();
  } catch (error) {
    showError(error.message);
    setStatus("Sign in failed.");
  } finally {
    setBusy(false);
  }
});

logoutButton.addEventListener("click", async () => {
  clearError();
  clearNotice();
  setStatus("Signing out...");
  setBusy(true);

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    currentUser = null;
    renderSession();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

resetButton.addEventListener("click", async () => {
  console.log("VOL password setup/reset button clicked");
  clearError();
  clearNotice();

  const email = emailInput.value.trim();
  console.log("VOL password setup/reset email value", email);

  if (!email) {
    showError("Enter your email first.");
    emailInput.focus();
    return;
  }

  setStatus("Sending setup link...");
  setBusy(true);

  try {
    if (!supabase) {
      supabase = await getSupabaseClient();
    }

    const redirectTo = `${window.location.origin}/auth/callback`;
    console.log("VOL password setup/reset redirectTo", redirectTo);

    const resetResponse = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo
    });
    console.log("Supabase reset response", resetResponse);

    const { error } = resetResponse;
    if (error) {
      console.error("Supabase reset error", error);
      throw error;
    }

    showNotice("If this email is authorized for VOL Health, you'll receive a setup link.");
    setStatus("Setup link request received.");
  } catch (error) {
    console.error("Supabase reset error", error);
    showError("We could not send the setup link. Please try again.");
    setStatus("Setup link request failed.");
  } finally {
    setBusy(false);
  }
});

async function renderSession() {
  clearError();
  userEmailEl.textContent = currentUser?.email || "Not signed in";
  logoutButton.hidden = !currentUser;

  if (!currentUser) {
    setStatus("Sign in to query your communities.");
    renderCommunities([]);
    return;
  }

  setStatus("Loading communities...");
  await loadCommunities();
}

async function loadCommunities() {
  communitiesEl.innerHTML = '<li class="muted">Loading communities...</li>';

  try {
    const { data, error } = await supabase
      .from("communities")
      .select("*");

    if (error) throw error;

    renderCommunities(data || []);
    setStatus(data?.length ? "Communities loaded." : "No communities found for this login.");
  } catch (error) {
    communitiesEl.innerHTML = '<li class="muted">Unable to load communities.</li>';
    showError(error.message);
    setStatus("Community query failed.");
  }
}

function renderCommunities(communities) {
  if (!currentUser) {
    communitiesEl.innerHTML = '<li class="muted">No active session.</li>';
    return;
  }

  if (!communities.length) {
    communitiesEl.innerHTML = '<li class="muted">No communities returned by policy.</li>';
    return;
  }

  communitiesEl.innerHTML = communities
    .map((community) => {
      const label =
        community.name ||
        community.community_name ||
        community.title ||
        community.display_name ||
        community.id ||
        "Community";

      return `<li>${escapeHtml(String(label))}</li>`;
    })
    .join("");
}

function setBusy(isBusy) {
  loginButton.disabled = isBusy;
  resetButton.disabled = isBusy;
  logoutButton.disabled = isBusy;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = "";
  errorEl.hidden = true;
}

function showNotice(message) {
  noticeEl.textContent = message;
  noticeEl.hidden = false;
}

function clearNotice() {
  noticeEl.textContent = "";
  noticeEl.hidden = true;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
