import { getSupabaseClient } from "./lib/supabaseClient.js";

const form = document.querySelector("[data-password-form]");
const passwordInput = document.querySelector("[data-password]");
const confirmPasswordInput = document.querySelector("[data-confirm-password]");
const submitButton = document.querySelector("[data-submit-button]");
const statusEl = document.querySelector("[data-status]");
const noticeEl = document.querySelector("[data-notice]");
const errorEl = document.querySelector("[data-error]");

let supabase;
let recoveryReady = false;

init();

async function init() {
  setStatus("Preparing password setup...");
  setBusy(true);

  try {
    supabase = await getSupabaseClient();

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session?.user) {
        showPasswordForm();
      }
    });

    const urlState = getUrlState();
    console.log("VOL password callback URL state", {
      type: urlState.type,
      hasCode: Boolean(urlState.code),
      hasAccessToken: Boolean(urlState.accessToken),
      hasRefreshToken: Boolean(urlState.refreshToken),
      hasError: Boolean(urlState.error)
    });

    if (urlState.error) {
      console.error("VOL password callback URL error", urlState.error);
      showError("This setup link is invalid or has expired. Request a new setup link from the access page.");
      setStatus("Password setup unavailable.");
      return;
    }

    if (urlState.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(urlState.code);
      console.log("VOL password callback code exchange response", { data, error });
      if (error) {
        console.error("VOL password callback code exchange error", error);
        throw error;
      }
    }

    if (urlState.accessToken && urlState.refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: urlState.accessToken,
        refresh_token: urlState.refreshToken
      });
      console.log("VOL password callback hash session response", { data, error });
      if (error) {
        console.error("VOL password callback hash session error", error);
        throw error;
      }
    }

    const { data, error } = await supabase.auth.getSession();
    console.log("VOL password callback session response", {
      hasSession: Boolean(data.session),
      email: data.session?.user?.email,
      error
    });
    if (error) throw error;

    if ((urlState.type === "recovery" || urlState.hasRecoveryTokens || data.session?.user) && data.session?.user) {
      showPasswordForm();
      return;
    }

    if (urlState.hasRecoveryTokens) {
      window.setTimeout(() => {
        if (!recoveryReady) {
          showError("This setup link is invalid or has expired. Request a new setup link from the access page.");
          setStatus("Password setup unavailable.");
        }
      }, 2500);
      return;
    }

    showError("This setup link is invalid or has expired. Request a new setup link from the access page.");
    setStatus("Password setup unavailable.");
  } catch (error) {
    console.error("Password setup initialization failed", error);
    showError("Unable to prepare password setup. Request a new setup link and try again.");
    setStatus("Password setup unavailable.");
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  clearNotice();

  const newPassword = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!recoveryReady) {
    showError("This setup link is not ready. Request a new setup link from the access page.");
    return;
  }

  if (newPassword.length < 8) {
    showError("Use at least 8 characters for your password.");
    return;
  }

  if (newPassword !== confirmPassword) {
    showError("Passwords do not match.");
    return;
  }

  setStatus("Saving password...");
  setBusy(true);

  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw error;
    }

    showNotice("Password saved. Redirecting to community access...");
    setStatus("Password saved.");
    window.setTimeout(() => {
      window.location.assign("/auth-proof");
    }, 900);
  } catch (error) {
    console.error("Password update failed", error);
    showError("Unable to save password. Request a new setup link and try again.");
    setStatus("Password setup failed.");
  } finally {
    setBusy(false);
  }
});

function showPasswordForm() {
  recoveryReady = true;
  form.hidden = false;
  setStatus("Enter a new password to continue.");
}

function getUrlState() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    type: searchParams.get("type") || hashParams.get("type"),
    error: searchParams.get("error") || hashParams.get("error"),
    code: searchParams.get("code"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    hasRecoveryTokens:
      searchParams.has("code") ||
      hashParams.has("access_token") ||
      hashParams.has("refresh_token")
  };
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
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
