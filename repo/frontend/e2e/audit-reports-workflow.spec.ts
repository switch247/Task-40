import { expect, test } from "@playwright/test";

const auditSession = {
  userId: "u-auditor",
  username: "auditor",
  roles: ["auditor"],
  permissions: ["audit.read", "transactions.read", "auditor.release_freeze"]
};

async function mockAuditSession(page: import("@playwright/test").Page, items: unknown[] = []) {
  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auditSession) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-audit" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    if (path.endsWith("/reports/audit") && !path.endsWith("export.csv")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
      return;
    }
    if (path.endsWith("/reports/audit") && req.url().includes("from=2026-03-28")) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Invalid date format" }) });
      return;
    }
    if (path.includes("/transactions")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });
}

test("audit reports page loads and shows empty state before search", async ({ page }) => {
  await mockAuditSession(page);
  await page.goto("/audit-reports");
  await expect(page.getByRole("heading", { name: "Audit Reports" })).toBeVisible();
  await expect(page.getByText("No audit results yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("audit reports shows validation error for invalid MM/DD/YYYY date format", async ({ page }) => {
  await mockAuditSession(page);
  await page.goto("/audit-reports");

  await page.getByPlaceholder("03/28/2026").first().fill("2026-03-28");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("alert")).toContainText("MM/DD/YYYY");
});

test("audit reports shows validation error when from date is after to date", async ({ page }) => {
  await mockAuditSession(page);
  await page.goto("/audit-reports");

  const inputs = page.locator("input");
  await inputs.nth(0).fill("04/01/2026");
  await inputs.nth(1).fill("03/01/2026");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("alert")).toContainText("earlier than or equal to");
});

test("audit reports search returns and displays result rows", async ({ page }) => {
  const sampleItems = [
    { id: "a1", createdAt: new Date().toISOString(), actionType: "MERGE_APPLIED", notes: "merged duplicate story version" },
    { id: "a2", createdAt: new Date().toISOString(), actionType: "CHARGE_APPROVED", notes: "approved finance charge" }
  ];
  await mockAuditSession(page, sampleItems);
  await page.goto("/audit-reports");

  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("MERGE_APPLIED")).toBeVisible();
  await expect(page.getByText("merged duplicate story version")).toBeVisible();
  await expect(page.getByText("CHARGE_APPROVED")).toBeVisible();
});

test("audit reports filter by action type input is accepted", async ({ page }) => {
  await mockAuditSession(page);
  await page.goto("/audit-reports");

  const actionTypeInput = page.getByPlaceholder("e.g. MERGE_APPLIED");
  await actionTypeInput.fill("PERMISSION_CHANGE");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No audit results yet")).toBeVisible();
});

test("audit reports valid date range passes validation and triggers search", async ({ page }) => {
  const items = [{ id: "a3", createdAt: new Date().toISOString(), actionType: "AUTH_LOGIN_SUCCESS", notes: "login" }];
  await mockAuditSession(page, items);
  await page.goto("/audit-reports");

  const inputs = page.locator("input");
  await inputs.nth(0).fill("01/01/2026");
  await inputs.nth(1).fill("12/31/2026");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("AUTH_LOGIN_SUCCESS")).toBeVisible();
});

test("audit reports Export CSV button is visible and clickable", async ({ page }) => {
  await mockAuditSession(page);
  await page.goto("/audit-reports");

  const exportBtn = page.getByRole("button", { name: "Export CSV" });
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeEnabled();
  await exportBtn.click();
});
