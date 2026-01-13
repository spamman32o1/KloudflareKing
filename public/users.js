const userList = document.querySelector("#user-list");
const refreshBtn = document.querySelector("#refresh-users");
const template = document.querySelector("#user-card");
const form = document.querySelector("#user-form");
const errorMessage = document.querySelector("#user-error");
const usernameInput = document.querySelector("#new-username");
const passwordInput = document.querySelector("#new-password");
const roleSelect = document.querySelector("#new-role");

const handleUnauthorized = (response) => {
  if (response.status === 401) {
    window.location.href = "/login.html";
    return true;
  }
  if (response.status === 403) {
    window.location.href = "/index.html";
    return true;
  }
  return false;
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "";

const fetchUsers = async () => {
  const response = await fetch("/api/users");
  if (handleUnauthorized(response)) {
    return [];
  }
  const data = await response.json();
  return data.users || [];
};

const renderUsers = (users) => {
  userList.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No users found.";
    userList.appendChild(empty);
    return;
  }

  users.forEach((user) => {
    const node = template.content.cloneNode(true);
    const username = node.querySelector("[data-username]");
    const created = node.querySelector("[data-created]");
    const rolePicker = node.querySelector("[data-role]");
    const passwordField = node.querySelector("[data-password]");
    const saveBtn = node.querySelector("[data-save]");
    const status = node.querySelector("[data-status]");

    username.textContent = user.username;
    created.textContent = user.createdAt
      ? `Created ${formatDate(user.createdAt)}`
      : "";
    rolePicker.value = user.role;

    saveBtn.addEventListener("click", async () => {
      status.textContent = "";
      const nextRole = rolePicker.value;
      const nextPassword = passwordField.value.trim();
      if (nextRole === user.role && !nextPassword) {
        status.textContent = "No changes to save.";
        return;
      }
      const payload = { role: nextRole };
      if (nextPassword) {
        payload.password = nextPassword;
      }
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (handleUnauthorized(response)) {
        return;
      }
      const data = await response.json();
      if (response.ok) {
        user.role = data.user.role;
        status.textContent = "Saved.";
        passwordField.value = "";
      } else {
        status.textContent = data.error || "Save failed.";
      }
    });

    userList.appendChild(node);
  });
};

const loadUsers = async () => {
  const users = await fetchUsers();
  renderUsers(users);
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.textContent = "";
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const role = roleSelect.value;

  if (!username || !password) {
    errorMessage.textContent = "Username and password are required.";
    return;
  }

  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role })
  });

  if (handleUnauthorized(response)) {
    return;
  }

  const data = await response.json();
  if (response.ok) {
    usernameInput.value = "";
    passwordInput.value = "";
    roleSelect.value = "admin";
    loadUsers();
  } else {
    errorMessage.textContent = data.error || "Unable to create user.";
  }
});

refreshBtn.addEventListener("click", loadUsers);

loadUsers();
