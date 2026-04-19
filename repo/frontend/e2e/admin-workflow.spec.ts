import { expect, test } from "@playwright/test";

test("admin workspace loads overview and enforces change note requirement", async ({ page }) => {
  const overview = {
    roles: [{ id: "r1", name: "editor", permissionKeys: ["stories.review"] }],
    permissions: [{ id: "p1", key: "stories.review" }, { id: "p2", key: "audit.read" }],
    users: [
      { id: "u1", username: "editor", roleIds: ["r1"], roleNames: ["editor"], requestsPerMinute: 60 },
      { id: "u2", username: "finance_reviewer", roleIds: [], roleNames: [], requestsPerMinute: 60 }
    ],
    thresholds: [{ key: "SIMHASH_MAX_HAMMING", value: 8 }]
  };

  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage"] })
      });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-admin" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0, alertsOpen: 0, activeBanners: 0 } }) });
      return;
    }
    if (path.endsWith("/admin/overview")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
      return;
    }
    if (path.endsWith("/admin/operations/permission-sensitive")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "op1", actionType: "PERMISSION_CHANGE", entityType: "role", notes: "role updated", createdAt: new Date().toISOString() },
          { id: "op2", actionType: "AUTH_LOGIN_SUCCESS", entityType: "session", notes: "admin login", createdAt: new Date().toISOString() }
        ])
      });
      return;
    }
    if (path.includes("/admin/users/") && path.endsWith("/rate-limit") && req.method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
      return;
    }
    if (path.includes("/admin/users/") && path.endsWith("/roles") && req.method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
      return;
    }
    if (path.includes("/admin/thresholds/") && req.method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ key: "SIMHASH_MAX_HAMMING", value: 8 }) });
      return;
    }
    if (path.endsWith("/admin/roles") && req.method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "r-new", name: "editor" }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Workspace" })).toBeVisible();

  await expect(page.getByText("SIMHASH_MAX_HAMMING")).toBeVisible();
  await expect(page.getByText("editor")).toBeVisible();
  await expect(page.getByText("PERMISSION_CHANGE")).toBeVisible();

  const saveThresholdBtn = page.getByRole("button", { name: "Save Threshold" });
  await expect(saveThresholdBtn).toBeDisabled();

  await page.getByPlaceholder("Record the reason for this admin change").fill("updating threshold value for dedup tuning");
  await expect(saveThresholdBtn).toBeEnabled();

  await saveThresholdBtn.click();
  await expect(page.getByText("SIMHASH_MAX_HAMMING")).toBeVisible();
});

test("admin workspace set user rate limit requires change note", async ({ page }) => {
  const overview = {
    roles: [{ id: "r1", name: "editor", permissionKeys: ["stories.review"] }],
    permissions: [{ id: "p1", key: "stories.review" }],
    users: [{ id: "u1", username: "editor", roleIds: ["r1"], roleNames: ["editor"], requestsPerMinute: 60 }],
    thresholds: []
  };

  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage"] }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-admin" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    if (path.endsWith("/admin/overview")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
      return;
    }
    if (path.endsWith("/admin/operations/permission-sensitive")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Workspace" })).toBeVisible();

  const rateLimitBtn = page.getByRole("button", { name: "Set Rate Limit" });
  await expect(rateLimitBtn).toBeDisabled();

  await page.getByPlaceholder("Record the reason for this admin change").fill("adjusting rate limit for editor user");
  await expect(rateLimitBtn).toBeEnabled();
});

test("admin workspace permission-sensitive ops log is visible with entries", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage"] }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-admin" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    if (path.endsWith("/admin/overview")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roles: [], permissions: [], users: [], thresholds: [] }) });
      return;
    }
    if (path.endsWith("/admin/operations/permission-sensitive")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "op1", actionType: "THRESHOLD_CONFIG_CHANGE", entityType: "system_threshold", notes: "threshold adjusted", createdAt: new Date().toISOString() }
        ])
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/admin");
  await expect(page.getByText("THRESHOLD_CONFIG_CHANGE")).toBeVisible();
  await expect(page.getByText("threshold adjusted")).toBeVisible();
});
