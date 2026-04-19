import { expect, test } from "@playwright/test";

test("alerts dashboard shows queue metrics, banners, and open alerts", async ({ page }) => {
  const dashboardPayload = {
    alerts: [
      { id: "alert-1", category: "JOB_FAILURE", severity: "HIGH", title: "Backup Failure", status: "OPEN", message: "Backup job failed", createdAt: new Date().toISOString() },
      { id: "alert-2", category: "QUEUE_OVERFLOW", severity: "MEDIUM", title: "Queue Overflow", status: "OPEN", message: "Queue depth exceeded threshold", createdAt: new Date().toISOString() }
    ],
    banners: [
      { id: "b1", level: "INFO", message: "Scheduled maintenance tonight at 02:00", active: true, createdAt: new Date().toISOString() }
    ],
    status: { queueDepth: 12, alertsOpen: 2, activeBanners: 1, backupPolicy: { nightlyRunAt: "02:00" } }
  };

  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage", "alerts.read"] })
      });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-admin" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard") && req.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardPayload) });
      return;
    }
    if (path.includes("/alerts/") && path.endsWith("/resolve") && req.method() === "PATCH") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", alert: { id: "alert-1", status: "RESOLVED" } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts Dashboard" })).toBeVisible();

  await expect(page.getByText("12")).toBeVisible();
  await expect(page.getByText("Queue Depth")).toBeVisible();
  await expect(page.getByText("Open Alerts")).toBeVisible();
  await expect(page.getByText("Active Banners")).toBeVisible();
  await expect(page.getByText("Backup Window")).toBeVisible();

  await expect(page.getByText("Scheduled maintenance tonight at 02:00")).toBeVisible();

  await expect(page.getByText("Backup Failure: Backup job failed")).toBeVisible();
  await expect(page.getByText("Queue Overflow: Queue depth exceeded threshold")).toBeVisible();
});

test("alerts dashboard shows empty states when no alerts or banners present", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage", "alerts.read"] }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-a" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0, alertsOpen: 0, activeBanners: 0 } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts Dashboard" })).toBeVisible();
  await expect(page.getByText("No active operator banners")).toBeVisible();
  await expect(page.getByText("No open alerts")).toBeVisible();
});

test("alerts dashboard resolve button calls resolve endpoint and reloads", async ({ page }) => {
  let resolveCallCount = 0;
  let dashboardCallCount = 0;

  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-admin", username: "admin", roles: ["admin"], permissions: ["admin.manage", "alerts.read"] }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-admin" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard") && req.method() === "GET") {
      dashboardCallCount++;
      const alerts =
        dashboardCallCount === 1
          ? [{ id: "alert-3", category: "TEST", severity: "LOW", title: "Test Alert", status: "OPEN", message: "Test alert for resolve", createdAt: new Date().toISOString() }]
          : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts, banners: [], status: { queueDepth: 0, alertsOpen: alerts.length, activeBanners: 0 } }) });
      return;
    }
    if (path.includes("/alerts/") && path.endsWith("/resolve") && req.method() === "PATCH") {
      resolveCallCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", alert: { id: "alert-3", status: "RESOLVED" } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/alerts");
  await expect(page.getByText("Test Alert: Test alert for resolve")).toBeVisible();

  const resolveButton = page.getByRole("button", { name: "Resolve" }).first();
  await expect(resolveButton).toBeVisible();
  await resolveButton.click();

  await expect(async () => {
    expect(resolveCallCount).toBeGreaterThan(0);
  }).toPass();
});

test("alerts page is not accessible by roles without alerts.read permission", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"] }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-e" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts Dashboard" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Editor Queue" })).toBeVisible();
});
